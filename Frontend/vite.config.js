import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    base: mode === 'production' ? '/loom/' : '/',
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://backend:5003',
                changeOrigin: true,
            },
            '/loom/api': {
                target: 'http://backend:5003',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/loom/, ''),
            },
        },
    },
}));