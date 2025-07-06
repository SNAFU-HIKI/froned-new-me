import React from 'react';
import { ArrowLeft, User, Bell, Palette, Globe } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';

export const SettingsPage: React.FC = () => {
  const settingsCategories = [
    {
      title: 'Account',
      icon: User,
      items: [
        { name: 'Profile Settings', description: 'Manage your account information' },
        { name: 'Preferences', description: 'Customize your experience' },
      ]
    },
    {
      title: 'Notifications',
      icon: Bell,
      items: [
        { name: 'Email Notifications', description: 'Configure email alerts' },
        { name: 'Push Notifications', description: 'Manage push notifications' },
      ]
    },
    {
      title: 'Appearance',
      icon: Palette,
      items: [
        { name: 'Theme', description: 'Choose your preferred theme' },
        { name: 'Language', description: 'Select your language' },
      ]
    },
    {
      title: 'Integration',
      icon: Globe,
      items: [
        { name: 'Google Workspace', description: 'Manage Google integrations' },
        { name: 'API Settings', description: 'Configure API access' },
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center space-x-4 mb-4">
            <Link to="/chat">
              <Button variant="ghost" size="sm" icon={ArrowLeft}>
                Back to Chat
              </Button>
            </Link>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-2">
            Manage your account settings and preferences
          </p>
        </div>

        {/* Settings Categories */}
        <div className="space-y-8">
          {settingsCategories.map((category) => {
            const IconComponent = category.icon;
            return (
              <div key={category.title} className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <IconComponent className="w-5 h-5 text-gray-600" />
                    </div>
                    <h2 className="text-xl font-semibold text-gray-900">{category.title}</h2>
                  </div>
                </div>
                <div className="divide-y divide-gray-200">
                  {category.items.map((item) => (
                    <div key={item.name} className="p-6 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">{item.name}</h3>
                          <p className="text-gray-600 mt-1">{item.description}</p>
                        </div>
                        <div className="text-gray-400">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};