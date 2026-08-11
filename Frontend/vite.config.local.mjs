import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: { port: 5199, proxy: { '/api': { target: 'http://localhost:5003', changeOrigin: true } } },
});
