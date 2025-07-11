import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth-token') || 
                  JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state?.token;
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth-storage');
      localStorage.removeItem('auth-token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  checkAuth: () => api.get('/auth/user'),
  logout: () => api.post('/auth/logout'),
  googleLogin: () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  },
  login: async (credentials: { email: string; password: string }) => {
    return api.post('/auth/login', credentials);
  },
  updatePreferences: (preferences: any) => api.put('/api/user/preferences', preferences),
  getPreferences: () => api.get('/api/user/preferences'),
};

// Chat API
export const chatAPI = {
  sendMessage: (message: string, chatId?: string, model?: string, enabledTools?: string[]) =>
    api.post('/api/chat', { message, chatId, model, enabledTools }),
  sendMessageWithAttachments: (formData: FormData) => {
    return api.post('/api/chat', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  getChat: (chatId: string) => api.get(`/api/chat/${chatId}`),
  getUserChats: (userId: string) => api.get(`/api/chats/${userId}`),
  deleteChat: (chatId: string) => api.delete(`/api/chat/${chatId}`),
};

// Tools API
export const toolsAPI = {
  getAvailableTools: () => api.get('/api/tools'),
  updateToolPreferences: (enabledTools: string[]) => 
    api.put('/api/tools/preferences', { enabledTools }),
};

// Projects API
export const projectsAPI = {
  getUserProjects: (userId: string) => api.get(`/api/projects/${userId}`),
  createProject: (data: { name: string; description?: string }) => 
    api.post('/api/projects', data),
  updateProject: (projectId: string, data: { name?: string; description?: string }) =>
    api.put(`/api/projects/${projectId}`, data),
  deleteProject: (projectId: string) => api.delete(`/api/projects/${projectId}`),
  moveChatToProject: (chatId: string, projectId: string | null) =>
    api.put(`/api/chats/${chatId}/project`, { projectId }),
};

// Feedback API
export const feedbackAPI = {
  submitFeedback: (data: { message: string; rating: number }) => 
    api.post('/api/feedback', data),
  getFeedback: () => api.get('/api/feedback'),
};

// Health API
export const healthAPI = {
  getStatus: () => api.get('/api/health'),
};

// Attachments API
export const attachmentsAPI = {
  download: (attachmentId: string) => api.get(`/api/attachments/${attachmentId}/download`, {
    responseType: 'blob'
  }),
};

export default api;