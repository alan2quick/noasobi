import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTemplates } from './core/store';
import { startPersistence } from './core/storage/sync';
import { startAudio } from './audio/sync';

initTemplates();
// Restores designs, settings and the saved world (or seeds the demo world), then keeps them saved.
void startPersistence();
startAudio();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
