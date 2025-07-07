const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const OpenAI = require('openai');
require('dotenv').config();

// Import models
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const Attachment = require('./models/Attachment');
const AuthToken = require('./models/AuthToken');
const Feedback = require('./models/Feedback');

// Import services
const FileUploadService = require('./services/fileUpload');
const FileParser = require('./services/fileParser');

// Import middleware
const upload = require('./middleware/upload');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Google OAuth client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      process.env.FRONTEND_URL
    ].filter(Boolean);
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// MCP Server Management
let mcpProcess = null;
let mcpReady = false;

const startMCPServer = async (userId = null) => {
  try {
    console.log('🚀 Starting MCP server...');
    
    if (mcpProcess) {
      console.log('⚠️ Terminating existing MCP process...');
      mcpProcess.kill();
      mcpProcess = null;
    }

    // Set up environment variables for MCP server
    const env = { ...process.env };
    
    if (userId) {
      try {
        const tokenData = await AuthToken.findByUserId(userId);
        if (tokenData) {
          env.GOOGLE_ACCESS_TOKEN = tokenData.access_token;
          env.GOOGLE_REFRESH_TOKEN = tokenData.refresh_token;
          env.GOOGLE_ID_TOKEN = tokenData.id_token;
          env.GOOGLE_TOKEN_EXPIRES_AT = tokenData.expires_at;
          console.log('✅ Google tokens loaded for MCP server');
        }
      } catch (error) {
        console.error('⚠️ Failed to load tokens for MCP server:', error);
      }
    }

    const pythonPath = process.env.PYTHON_PATH || 'python3';
    mcpProcess = spawn(pythonPath, [path.join(__dirname, 'mcp_toolkit.py')], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    mcpProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('MCP stdout:', output);
      if (output.includes('MCP server ready')) {
        mcpReady = true;
        console.log('✅ MCP server is ready');
      }
    });

    mcpProcess.stderr.on('data', (data) => {
      console.error('MCP stderr:', data.toString());
    });

    mcpProcess.on('close', (code) => {
      console.log(`MCP process exited with code ${code}`);
      mcpReady = false;
      mcpProcess = null;
    });

    mcpProcess.on('error', (error) => {
      console.error('MCP process error:', error);
      mcpReady = false;
      mcpProcess = null;
    });

    // Wait a bit for the server to start
    await new Promise(resolve => setTimeout(resolve, 3000));
    
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    mcpReady = false;
  }
};

// Start MCP server on startup
startMCPServer();

// Google OAuth routes
app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
    }

    const { tokens } = await oauth2Client.getTokens(code);
    oauth2Client.setCredentials(tokens);

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    
    let user = await User.findByGoogleId(payload.sub);
    
    if (!user) {
      user = await User.create({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture
      });
    } else {
      user = await User.update(user.id, {
        name: payload.name,
        picture: payload.picture
      });
    }

    // Store or update tokens
    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
    
    try {
      await AuthToken.update(user.id, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        id_token: tokens.id_token,
        expires_at: expiresAt.toISOString()
      });
    } catch (updateError) {
      await AuthToken.create({
        userId: user.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        idToken: tokens.id_token,
        expiresAt: expiresAt.toISOString()
      });
    }

    // Generate JWT token
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.SESSION_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Restart MCP server with new tokens
    await startMCPServer(user.id);

    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${jwtToken}`);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }
});

app.get('/auth/user', authenticateToken, async (req, res) => {
  try {
    res.json({
      authenticated: true,
      user: req.user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

app.post('/auth/logout', authenticateToken, async (req, res) => {
  try {
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
    });
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Chat routes
app.post('/api/chat', authenticateToken, upload.array('attachments', 5), async (req, res) => {
  try {
    const { message, chatId, model = 'gpt-4', enabledTools = [] } = req.body;
    const userId = req.user.id;
    const files = req.files || [];

    console.log('📨 Received chat request:', { message, chatId, model, filesCount: files.length });

    if (!message && files.length === 0) {
      return res.status(400).json({ error: 'Message or files required' });
    }

    let currentChat;
    
    if (chatId && chatId !== 'new') {
      currentChat = await Chat.findById(chatId);
      if (!currentChat || currentChat.user_id !== userId) {
        return res.status(404).json({ error: 'Chat not found' });
      }
    } else {
      const title = message ? message.substring(0, 50) + (message.length > 50 ? '...' : '') : 'File Upload';
      currentChat = await Chat.create(userId, title);
    }

    // Handle file uploads
    let attachmentData = [];
    let fileContents = '';
    
    if (files.length > 0) {
      console.log('📎 Processing file uploads...');
      
      for (const file of files) {
        try {
          const uploadResult = await FileUploadService.uploadFile(file, userId);
          
          const attachment = await Attachment.create({
            messageId: null, // Will be updated after message creation
            userId: userId,
            filename: uploadResult.filename,
            originalName: uploadResult.originalName,
            mimeType: uploadResult.mimeType,
            fileSize: uploadResult.fileSize,
            storagePath: uploadResult.storagePath
          });
          
          attachmentData.push(attachment);
          
          // Parse file content
          const content = await FileParser.parseFile(
            uploadResult.storagePath,
            uploadResult.mimeType,
            uploadResult.originalName
          );
          
          fileContents += `\n\n--- File: ${uploadResult.originalName} ---\n${content}`;
          
        } catch (fileError) {
          console.error('File processing error:', fileError);
          fileContents += `\n\n--- File: ${file.originalname} ---\nError processing file: ${fileError.message}`;
        }
      }
    }

    // Create user message
    const fullMessage = message + fileContents;
    const userMessage = await Message.create({
      chatId: currentChat.id,
      userId: userId,
      role: 'user',
      content: fullMessage,
      attachments: attachmentData.map(att => att.id)
    });

    // Update attachment message_id
    for (const attachment of attachmentData) {
      await Attachment.update(attachment.id, { message_id: userMessage.id });
    }

    // Prepare OpenAI messages
    const messages = [
      {
        role: 'system',
        content: `You are a helpful AI assistant with access to Google Workspace tools. You can help users with Google Drive, Gmail, Calendar, and file analysis. Always be helpful and provide detailed responses.

Available tools: ${enabledTools.join(', ')}

If the user uploads files, analyze them and provide insights based on their content.`
      },
      {
        role: 'user',
        content: fullMessage
      }
    ];

    // Get available tools (fallback list)
    const availableTools = [
      {
        type: "function",
        function: {
          name: "drive_search_files",
          description: "Search for files in Google Drive",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              limit: { type: "number", description: "Maximum number of results" }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "gmail_send_email",
          description: "Send an email via Gmail",
          parameters: {
            type: "object",
            properties: {
              to: { type: "string", description: "Recipient email address" },
              subject: { type: "string", description: "Email subject" },
              body: { type: "string", description: "Email body" }
            },
            required: ["to", "subject", "body"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "calendar_create_event",
          description: "Create a calendar event",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Event title" },
              start: { type: "string", description: "Start time (ISO format)" },
              end: { type: "string", description: "End time (ISO format)" },
              attendees: { type: "array", items: { type: "string" }, description: "Attendee email addresses" }
            },
            required: ["title", "start", "end"]
          }
        }
      }
    ];

    // Filter tools based on enabled tools
    const filteredTools = availableTools.filter(tool => 
      enabledTools.length === 0 || enabledTools.includes(tool.function.name)
    );

    console.log('🤖 Calling OpenAI with', filteredTools.length, 'tools');

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: model,
      messages: messages,
      tools: filteredTools.length > 0 ? filteredTools : undefined,
      tool_choice: filteredTools.length > 0 ? "auto" : undefined,
      temperature: 0.7,
      max_tokens: 2000
    });

    let response = completion.choices[0].message.content;
    let toolsUsed = [];

    // Handle tool calls
    if (completion.choices[0].message.tool_calls) {
      console.log('🔧 Processing tool calls...');
      
      for (const toolCall of completion.choices[0].message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        
        console.log(`🛠️ Executing tool: ${toolName}`, toolArgs);
        toolsUsed.push(toolName);
        
        // For now, simulate tool execution
        response += `\n\n[Tool: ${toolName} executed with parameters: ${JSON.stringify(toolArgs)}]`;
      }
    }

    // Create assistant message
    await Message.create({
      chatId: currentChat.id,
      userId: userId,
      role: 'assistant',
      content: response,
      model: model,
      toolsUsed: toolsUsed
    });

    // Update chat timestamp
    await Chat.update(currentChat.id, { updated_at: new Date().toISOString() });

    res.json({
      response: response,
      chatId: currentChat.id,
      model: model,
      toolsUsed: toolsUsed
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

app.get('/api/chat/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const chat = await Chat.getWithMessages(chatId, userId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json(chat);
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ error: 'Failed to get chat' });
  }
});

app.get('/api/chats/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const chats = await Chat.findByUserId(userId);
    res.json({ chats });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

app.delete('/api/chat/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const chat = await Chat.findById(chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    if (chat.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await Chat.delete(chatId);
    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// Feedback routes
app.post('/api/feedback', authenticateToken, async (req, res) => {
  try {
    const { message, rating } = req.body;
    const user = req.user;

    console.log('📝 Submitting feedback for user:', user.email);

    if (!message || !rating) {
      return res.status(400).json({ error: 'Message and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const feedback = await Feedback.create({
      userId: user.id,
      userName: user.name,
      userImage: user.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6366f1&color=fff`,
      message: message.trim(),
      rating
    });

    console.log('✅ Feedback submitted successfully:', feedback.id);
    res.json({ 
      message: 'Feedback submitted successfully',
      feedback: {
        id: feedback.id,
        message: feedback.message,
        rating: feedback.rating,
        created_at: feedback.created_at
      }
    });
  } catch (error) {
    console.error('❌ Feedback submission error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

app.get('/api/feedback', async (req, res) => {
  try {
    const feedback = await Feedback.findPublicFeedback(10);
    res.json({ feedback });
  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({ error: 'Failed to get feedback' });
  }
});

// Tools routes
app.get('/api/tools', authenticateToken, async (req, res) => {
  try {
    // Return available tools
    const tools = [
      {
        function: {
          name: "drive_search_files",
          description: "Search for files in Google Drive by name or content"
        }
      },
      {
        function: {
          name: "drive_read_file",
          description: "Read the content of a file from Google Drive"
        }
      },
      {
        function: {
          name: "gmail_send_email",
          description: "Send an email via Gmail"
        }
      },
      {
        function: {
          name: "gmail_list_messages",
          description: "List recent Gmail messages"
        }
      },
      {
        function: {
          name: "calendar_create_event",
          description: "Create a new calendar event"
        }
      },
      {
        function: {
          name: "calendar_list_events",
          description: "List upcoming calendar events"
        }
      }
    ];

    res.json({ tools });
  } catch (error) {
    console.error('Get tools error:', error);
    res.status(500).json({ error: 'Failed to get tools' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    mcp_ready: mcpReady,
    environment: process.env.NODE_ENV || 'development'
  });
});

// MCP status endpoint
app.get('/api/mcp/status', (req, res) => {
  res.json({
    ready: mcpReady,
    process_running: mcpProcess !== null,
    pid: mcpProcess ? mcpProcess.pid : null
  });
});

// MCP restart endpoint
app.post('/api/mcp/restart', authenticateToken, async (req, res) => {
  try {
    await startMCPServer(req.user.id);
    res.json({ message: 'MCP server restarted' });
  } catch (error) {
    console.error('MCP restart error:', error);
    res.status(500).json({ error: 'Failed to restart MCP server' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});