import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BETA = process.env.VITE_BETA === '1';

/** Version bêta : nom et icônes distincts sur l'écran d'accueil du téléphone. */
function beta(): Plugin {
  let outDir = 'dist';
  return {
    name: 'cng-beta',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml: (html) => html.replace('<title>CNG Vinted</title>', '<title>CNG Vinted Bêta</title>').replace('content="CNG Vinted"', 'content="CNG Bêta"'),
    closeBundle() {
      const mf = resolve(outDir, 'manifest.webmanifest');
      const m = JSON.parse(readFileSync(mf, 'utf8'));
      writeFileSync(mf, JSON.stringify({ ...m, name: 'CNG Vinted Bêta', short_name: 'CNG Bêta' }, null, 2));
      for (const f of ['icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png']) copyFileSync(resolve('beta-assets', f), resolve(outDir, f));
    },
  };
}

// GitHub Pages sert le site sous /vinted-profit-ai/ (et la bêta sous /vinted-profit-ai/beta/)
export default defineConfig({
  base: process.env.VITE_BASE ?? '/vinted-profit-ai/',
  plugins: [react(), ...(BETA ? [beta()] : [])],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
