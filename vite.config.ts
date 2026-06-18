import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Prevent Vite from obscuring Rust/Tauri errors in the terminal.
  clearScreen: false,
  // Tauri dev server expects a fixed port.
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: {
      // Don't watch the Rust backend; cargo handles that.
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
  // Expose VITE_ and TAURI_ env vars to the client.
  envPrefix: ['VITE_', 'TAURI_'],
});
