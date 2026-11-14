import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './components/ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <div className="backdrop" aria-hidden="true" />
        <div className="orbs" aria-hidden="true">
          <div className="orb a" />
          <div className="orb b" />
        </div>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
