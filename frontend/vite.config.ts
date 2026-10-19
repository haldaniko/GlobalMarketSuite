import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/uploads': process.env.BACKEND_PROXY_URL || 'http://localhost:4000',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
});
