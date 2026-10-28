/**
 * Connexion « Se connecter avec Google ».
 *
 * L'identifiant client OAuth est public par nature (il est visible dans toute page web qui l'utilise) :
 * il identifie l'appli auprès de Google, il ne donne accès à rien sans l'accord de l'utilisateur.
 * Il se crée dans Google Cloud (projet « CNG Vinted ») avec ces adresses autorisées :
 *   https://clevinngouala597-a11y.github.io   (origine JavaScript)
 *   https://clevinngouala597-a11y.github.io/vinted-profit-ai/  et  …/vinted-profit-ai/beta/  (redirection)
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || '18738760321-pimka0ptd95k23gd0t5c4lnf183i7ij7.apps.googleusercontent.com';

/** Lecture seule de Gmail (e-mails Vinted), fichiers créés par l'appli dans Drive (sauvegardes), adresse e-mail. */
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
];

/** Même recherche que le script Google. */
export const GMAIL_QUERY = 'from:(vinted.fr OR vinted.com) subject:(vendu OR finalisée OR "mise à jour" OR facture OR reçu OR remboursée OR bordereau)';
