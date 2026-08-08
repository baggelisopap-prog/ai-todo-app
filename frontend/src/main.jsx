import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import App from './App.jsx'
import './index.css'
import { initTheme } from './utils/theme'

// index.html's inline script has already set the attribute for the first paint;
// this re-applies it from the same stored value and, more importantly, starts
// listening for OS changes so "System" keeps meaning the system.
initTheme()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
