import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import '@xterm/xterm/css/xterm.css';
import './monaco-setup';
import './styles.css';
import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('THETERM: #root container not found in index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
