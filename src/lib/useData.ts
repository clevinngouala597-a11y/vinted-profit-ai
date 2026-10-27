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
