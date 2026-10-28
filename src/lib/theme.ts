/** Apparence de l'appli : sombre (par défaut), claire, ou qui suit le réglage du téléphone. */
export type Theme = 'sombre' | 'clair' | 'auto';

const media = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null);

export function resolveTheme(t: Theme | undefined): 'dark' | 'light' {
  if (t === 'clair') return 'light';
  if (t === 'auto') return media()?.matches ? 'light' : 'dark';
  return 'dark';
}

/** Applique le thème et le suit si « auto ». Renvoie de quoi arrêter le suivi. */
export function applyTheme(t: Theme | undefined): () => void {
  const set = () => {
    const mode = resolveTheme(t);
    document.documentElement.dataset.theme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'light' ? '#F3F5F2' : '#090B0A');
  };
  set();
  const m = media();
  if (t !== 'auto' || !m) return () => {};
  m.addEventListener('change', set);
  return () => m.removeEventListener('change', set);
}
