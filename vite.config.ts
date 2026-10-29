import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

/**
 * Liste blanche des sites que l'appli peut contacter (Content-Security-Policy).
 * Si du code piégé arrivait dans l'appli, il ne pourrait ni charger de script étranger
 * ni envoyer tes données ailleurs que vers ces adresses.
 */
const CONNECT = [
  "'self'",
  'https://script.google.com', 'https://script.googleusercontent.com', // ton script Google (synchro, sauvegarde)
  'https://ntfy.sh', // notifications
  'https://gmail.googleapis.com', 'https://www.googleapis.com', 'https://oauth2.googleapis.com', // connexion Google (Gmail, Drive)
  'https://api.anthropic.com', // Annonce IA (avec ta clé)
  'https://cdn.jsdelivr.net', 'https://tessdata.projectnaptha.com', // lecture des tickets (OCR dans le téléphone)
];
function csp(): Plugin {
  return {
    name: 'cng-csp',
    apply: 'build',
    transformIndexHtml(html) {
      // le petit script de l'écran de chargement est autorisé par son empreinte exacte
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
      const policy = [
        "default-src 'self'",
        `script-src 'self' ${inline.join(' ')} 'wasm-unsafe-eval' https://cdn.jsdelivr.net`,
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        `connect-src ${CONNECT.join(' ')}`,
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; ');
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

// GitHub Pages sert le site à la racine de https://cngapp.github.io/ (et la bêta sous /beta/)
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), csp(), ...(BETA ? [beta()] : [])],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
