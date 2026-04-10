import { useState } from 'react';
import type { AppConfig } from './lib/api';
import { Login } from './components/Login';
import { MainDashboard } from './components/MainDashboard';

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);

  const handleLogout = () => {
    setConfig(null);
  };

  if (!config) {
    return <Login onLogin={setConfig} />;
  }

  return <MainDashboard config={config} onLogout={handleLogout} />;
}

export default App;
