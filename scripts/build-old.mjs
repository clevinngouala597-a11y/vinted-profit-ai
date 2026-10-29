// Ancienne adresse (…github.io/vinted-profit-ai/) : page de déménagement qui transfère les données
// de l'appareil vers https://cngapp.github.io et y redirige. Même page pour la bêta et les anciens liens.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
const out = 'dist-old';
mkdirSync(`${out}/beta`, { recursive: true });
for (const f of ['index.html', 'beta/index.html', '404.html']) copyFileSync('bridge/index.html', `${out}/${f}`);
writeFileSync(`${out}/.nojekyll`, '');
// l'ancien service worker est remplacé par un service worker vide qui se désinstalle
const sw = "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister().then(()=>self.clients.matchAll()).then(cs=>cs.forEach(c=>c.navigate(c.url)))));";
writeFileSync(`${out}/sw.js`, sw);
writeFileSync(`${out}/beta/sw.js`, sw);
console.log('Page de déménagement prête dans dist-old/');
