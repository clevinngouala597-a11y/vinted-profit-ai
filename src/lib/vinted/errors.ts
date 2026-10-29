/** Erreur de synchronisation, avec un message prêt à afficher. */
export class SyncError extends Error {}

/** Erreur passagère (réseau coupé, serveur surchargé, trop de demandes) : la demande est retentée. */
export class TransientSyncError extends SyncError {}

/** Attentes entre deux essais (millisecondes). Modifiables pour les tests. */
let delays = [800, 2500];
export const setRetryDelays = (d: number[]) => { delays = d; };

/** Exécute `fn`, et la relance après une erreur passagère (2 nouvelles tentatives par défaut). */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TransientSyncError) || attempt >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
