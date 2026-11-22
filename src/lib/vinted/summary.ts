/** Résumé d'une synchro en une phrase (toasts et écran Synchro). */
import type { SyncResult } from './sync';

export const syncSummary = (r: SyncResult) =>
  (r.added === 0
    ? 'Aucun nouvel e-mail Vinted.'
    : `${r.applied} opération${r.applied > 1 ? 's' : ''} enregistrée${r.applied > 1 ? 's' : ''}${r.inbox ? ` · ${r.inbox} à valider` : ''}.`)
  + (r.failed ? ` ${r.failed} e-mail${r.failed > 1 ? 's' : ''} pas encore lu${r.failed > 1 ? 's' : ''} (coupure) : ${r.failed > 1 ? 'ils seront relus' : 'il sera relu'} à la prochaine synchro.` : '');
