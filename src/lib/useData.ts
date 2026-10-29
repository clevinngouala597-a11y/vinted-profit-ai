import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext } from 'react';
import { loadDataset } from './actions';
import type { Dataset } from './types';

/** Données en direct : toute écriture validée met à jour immédiatement les écrans et indicateurs. */
export function useLiveDataset(): Dataset | undefined {
  return useLiveQuery(() => loadDataset(), []);
}

export const DataContext = createContext<Dataset | null>(null);

export function useData(): Dataset {
  const d = useContext(DataContext);
  if (!d) throw new Error('DataContext manquant');
  return d;
}

/** Toutes les données, tous dressings confondus (comparaisons et exports par dressing). */
export const FullDataContext = createContext<Dataset | null>(null);
export function useFullData(): Dataset {
  const d = useContext(FullDataContext);
  // hors de l'appli (tests d'écran), on retombe sur les données affichées
  const v = useContext(DataContext);
  if (!d && !v) throw new Error('DataContext manquant');
  return (d ?? v)!;
}
