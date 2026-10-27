import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages sert le site sous /vinted-profit-ai/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/vinted-profit-ai/',
  plugins: [react()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
