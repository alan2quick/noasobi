import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTemplates } from './core/store';
import { seedDemoWorld } from './core/seed';

initTemplates();
seedDemoWorld();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
