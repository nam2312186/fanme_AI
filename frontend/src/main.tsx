import React from 'react';
import ReactDOM from 'react-dom/client';
import { LogtoProvider, type LogtoConfig } from '@logto/react';
import App from './App';
import { LogtoCallback } from './components/LogtoCallback';
import './App.css';

const logtoApiResource = import.meta.env.VITE_LOGTO_API_RESOURCE?.trim();

const logtoConfig: LogtoConfig = {
  endpoint: import.meta.env.VITE_LOGTO_ENDPOINT || 'http://localhost:3001/',
  appId: import.meta.env.VITE_LOGTO_APP_ID || 'YOUR_APP_ID',
  ...(logtoApiResource ? { resources: [logtoApiResource] } : {}),
  scopes: ['profile', 'email', 'offline_access'],
};

function Root() {
  if (window.location.pathname === '/callback') {
    return <LogtoCallback />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LogtoProvider config={logtoConfig}>
      <Root />
    </LogtoProvider>
  </React.StrictMode>
);
