import { useEffect, useState } from 'react';

/** Routage par hash (#/stock/123) : fonctionne sur GitHub Pages et en PWA hors ligne. */
export function useRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, '') || '').split('?')[0].split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => {
      setParts(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export const go = (path: string) => {
  location.hash = '#/' + path.replace(/^\//, '');
};

export const back = (fallback = '') => {
  if (history.length > 1) history.back();
  else go(fallback);
};

export function queryParam(name: string): string | null {
  const q = location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get(name) : null;
}
