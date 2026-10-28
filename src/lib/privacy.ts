/**
 * Mode discret : floute tous les montants de l'écran (quelqu'un regarde ton téléphone, capture à partager…).
 * Les montants sont repérés directement dans la page (texte avec « € » ou « % »), donc aucun écran n'est oublié.
 * Toucher un montant flouté l'affiche 3 secondes. Les exports et sauvegardes ne sont pas concernés.
 */
const MONEY = /\d[\d\s  .,]*\s*(€|%)|€/;
const PURE = /^[-+−]?\s*[\d\s  .,]+\s*(€|%|k€)$/;

let observer: MutationObserver | null = null;
let queued = false;

function mark(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!MONEY.test(n.nodeValue ?? '')) continue;
    let el = n.parentElement;
    if (!el || el.closest('script, style, .ptr, input, textarea, select, option')) continue;
    // « 0<span>,00 €</span> » : on floute le montant entier, pas seulement les centimes
    const up = el.parentElement;
    if (up && up !== document.body && PURE.test((up.textContent ?? '').trim())) el = up;
    el.classList.add('priv');
  }
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    mark(document.body);
  });
}

export function setPrivacy(on: boolean) {
  document.documentElement.classList.toggle('privacy', on);
  if (on && !observer) {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    mark(document.body);
  } else if (!on && observer) {
    observer.disconnect();
    observer = null;
  }
}

/** Toucher un montant flouté le dévoile quelques secondes. */
export function installPeek() {
  document.addEventListener('pointerdown', (e) => {
    if (!document.documentElement.classList.contains('privacy')) return;
    const el = (e.target as Element | null)?.closest?.('.priv');
    if (!el) return;
    el.classList.add('peek');
    window.setTimeout(() => el.classList.remove('peek'), 3000);
  }, { passive: true });
}
