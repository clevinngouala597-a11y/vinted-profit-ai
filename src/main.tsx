import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { handleGoogleRedirect } from './lib/google/auth';
import { handleTransfer } from './lib/transfer';

// retour de « Se connecter avec Google » : lu avant le routeur, puis l'écran d'avant est remis
(window as unknown as { __googleRedirect?: unknown }).__googleRedirect = handleGoogleRedirect();

// arrivée depuis l'ancienne adresse : les données de l'appareil sont enregistrées avant l'affichage
handleTransfer()
  .catch(() => null)
  .then((t) => {
    (window as unknown as { __transfer?: unknown }).__transfer = t;
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

// Fonctionnement hors ligne une fois installée sur l'écran d'accueil
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  });
}
