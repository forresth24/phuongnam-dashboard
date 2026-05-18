import { useState } from 'react';
import { Building2, KeyRound, Globe, ArrowRight } from 'lucide-react';
import type { AppConfig } from '../lib/api';
import { motion } from 'framer-motion';

declare const __APP_VERSION__: string | undefined;

interface LoginProps {
  onLogin: (config: AppConfig) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [apiUrl, setApiUrl] = useState(localStorage.getItem('apt_apiUrl') || '');
  const [token, setToken] = useState(localStorage.getItem('apt_token') || '');
  
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'Dev';

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!apiUrl || !token) return;
    
    // Save to local storage for convenience
    localStorage.setItem('apt_apiUrl', apiUrl);
    localStorage.setItem('apt_token', token);
    
    onLogin({ apiUrl, token });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ 
      background: 'radial-gradient(ellipse at top left, #4f46e5 0%, #1e1b4b 100%)' 
    }}>
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl shadow-2xl"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/20 text-white mb-4">
            <Building2 size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Phương Nam</h1>
          <p className="text-indigo-200">Management Dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-indigo-100 mb-1 ml-1">API URL (Cloudflare Worker)</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={20} />
              <input 
                type="url" 
                required
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://your-worker.workers.dev"
                className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-indigo-300/50 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-indigo-100 mb-1 ml-1">Access Token (API Key)</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={20} />
              <input 
                type="password" 
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-indigo-300/50 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
              />
            </div>
          </div>

          <button 
            type="submit"
            className="w-full flex items-center justify-center gap-2 bg-white text-indigo-900 font-bold text-lg py-3 rounded-xl hover:bg-indigo-50 transition-colors mt-4"
          >
            Access Dashboard
            <ArrowRight size={20} />
          </button>
        </form>
        <div className="mt-6 text-center text-xs text-indigo-300/40 font-mono">
          Phiên bản: {appVersion}
        </div>
      </motion.div>
    </div>
  );
}
