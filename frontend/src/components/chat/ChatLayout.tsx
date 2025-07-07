import React, { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Sidebar } from './Sidebar';
import { ChatInterface } from './ChatInterface';

export const ChatLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Get initial state from localStorage, default to true for desktop, false for mobile
    const saved = localStorage.getItem('sidebar-open');
    if (saved !== null) {
      return JSON.parse(saved);
    }
    return window.innerWidth >= 1024; // Default open on desktop
  });

  // Save sidebar state to localStorage
  useEffect(() => {
    localStorage.setItem('sidebar-open', JSON.stringify(sidebarOpen));
  }, [sidebarOpen]);

  // Handle responsive behavior
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        // On mobile, always close sidebar when resizing
        setSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => {
    console.log('Toggling sidebar from', sidebarOpen, 'to', !sidebarOpen);
    setSidebarOpen(!sidebarOpen);
  };

  const isMobile = () => {
    return window.innerWidth < 1024;
  };

  return (
    <div className="h-screen flex bg-gray-50">
      <Sidebar isOpen={sidebarOpen} onToggle={toggleSidebar} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with toggle button - show when sidebar is closed OR on mobile */}
        {(!sidebarOpen || isMobile()) && (
          <div className="bg-white border-b border-gray-200 p-4 flex items-center">
            <Button
              variant="ghost"
              size="sm"
              icon={Menu}
              onClick={toggleSidebar}
              className="mr-4"
              title="Open sidebar"
            />
            {!sidebarOpen && (
              <div className="flex items-center">
                <img 
                  src="/Screenshot_2025-07-06_234737-removebg-preview.png" 
                  alt="OrbitMCP Logo" 
                  className="w-6 h-6 mr-2"
                />
                <span className="font-semibold text-gray-900">OrbitMCP</span>
              </div>
            )}
          </div>
        )}
        
        <ChatInterface />
      </div>
    </div>
  );
};