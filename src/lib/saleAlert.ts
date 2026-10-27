/**
 * Alerte « nouvelle vente » : bannière en haut de l'écran + son de caisse enregistreuse.
 *
 * Le son est synthétisé (Web Audio) : aucun fichier audio n'est embarqué. Sur iPhone, le navigateur
 * n'autorise le son qu'après un premier toucher de l'écran : si une vente arrive avant, le son est
 * joué au premier toucher (tant que la bannière est récente). Le son suit le mode silencieux du téléphone.
 */

export interface SaleAlert {
  /** identifiant de l'e-mail Vinted */
  id: string;
  title: string;
  amount: number | null;
  /** la vente a été enregistrée seule (sinon elle attend dans « À valider ») */
  recorded: boolean;
}

const EVENT = 'cng:sales';

export function announceSales(sales: SaleAlert[]) {
  if (typeof window === 'undefined' || sales.length === 0) return;
  window.dispatchEvent(new CustomEvent<SaleAlert[]>(EVENT, { detail: sales }));
}

export function onSales(cb: (sales: SaleAlert[]) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<SaleAlert[]>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

// ---------------------------------------------------------------------------
// Son
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let pendingUntil = 0;

export const SOUNDS = [
  { id: 'kaching', label: 'Ka-ching (caisse)' },
  { id: 'pieces', label: 'Pluie de pièces' },
  { id: 'succes', label: 'Succès' },
  { id: 'arcade', label: 'Level up (arcade)' },
  { id: 'cloche', label: 'Clochette douce' },
  { id: 'perso', label: 'Mon son (fichier importé)' },
] as const;
export type SoundId = (typeof SOUNDS)[number]['id'];

let choice: SoundId = 'kaching';
let custom: { blob: Blob; buffer: AudioBuffer | null } | null = null;

/** Son choisi par l'utilisateur (et son fichier importé, s'il y en a un). */
export function configureSound(id: SoundId, file: Blob | null) {
  choice = id;
  if (!file) custom = null;
  else if (custom?.blob !== file) custom = { blob: file, buffer: null };
}

async function playCustom(c: AudioContext) {
  if (!custom) return render(c);
  try {
    if (!custom.buffer) custom.buffer = await c.decodeAudioData(await custom.blob.arrayBuffer());
    const src = c.createBufferSource();
    src.buffer = custom.buffer;
    const g = c.createGain();
    g.gain.value = 0.9;
    src.connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + Math.min(custom.buffer.duration, 8));
  } catch {
    render(c); // fichier illisible : son par défaut
  }
}

function playNow(c: AudioContext, id: SoundId = choice) {
  if (id === 'perso') return void playCustom(c);
  SYNTHS[id](c, c.currentTime + 0.02);
}

/** Joue un son précis tout de suite (aperçu dans les réglages, après un toucher). */
export function previewSound(id: SoundId) {
  const c = audio();
  if (!c) return;
  c.resume().then(() => playNow(c, id)).catch(() => {});
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  return ctx;
}

/** À appeler une fois au démarrage : débloque le son au premier toucher, et joue un son resté en attente. */
export function installAudioUnlock() {
  const unlock = () => {
    const c = audio();
    if (!c) return;
    c.resume().then(() => {
      if (Date.now() < pendingUntil) {
        pendingUntil = 0;
        playNow(c);
      }
    }).catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

/** Joue le son de vente (ou le met en attente du premier toucher si le navigateur bloque encore le son). */
export function playSaleSound() {
  const c = audio();
  if (!c) return;
  if (c.state === 'running') return playNow(c);
  pendingUntil = Date.now() + 30_000;
  c.resume().then(() => {
    if (c.state === 'running' && pendingUntil) {
      pendingUntil = 0;
      playNow(c);
    }
  }).catch(() => {});
}

/** « Ka-ching » : deux déclics de tiroir-caisse puis deux coups de clochette brillants. */
export function render(c: BaseAudioContext, at = c.currentTime + 0.02) {
  const master = c.createGain();
  master.gain.value = 0.55;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -10;
  master.connect(comp).connect(c.destination);

  // déclics mécaniques
  for (const [dt, freq] of [[0, 2600], [0.065, 3400]] as const) {
    const t = at + dt;
    const len = Math.floor(c.sampleRate * 0.035);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.4;
    const g = c.createGain();
    g.gain.value = 0.9;
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    // petit « tac » grave du tiroir
    const thump = c.createOscillator();
    const tg = c.createGain();
    thump.frequency.setValueAtTime(190, t);
    thump.frequency.exponentialRampToValueAtTime(70, t + 0.06);
    tg.gain.setValueAtTime(0.35, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    thump.connect(tg).connect(master);
    thump.start(t);
    thump.stop(t + 0.08);
  }

  // clochettes (partiels inharmoniques, comme une vraie cloche)
  const bell = (t: number, base: number, level: number) => {
    const partials: [number, number, number][] = [
      [1, 0.5, 1.5],
      [2.0, 0.28, 1.1],
      [2.76, 0.22, 0.9],
      [5.4, 0.1, 0.5],
      [8.93, 0.05, 0.3],
    ];
    for (const [ratio, amp, decay] of partials) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * ratio;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp * level, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  };
  bell(at + 0.13, 1568, 0.9); // sol
  bell(at + 0.21, 2093, 1); // do, plus aigu : « ching ! »
}

// ---------------------------------------------------------------------------
// Autres sons synthétisés (aucun fichier audio embarqué)
// ---------------------------------------------------------------------------

function out(c: BaseAudioContext, level = 0.5) {
  const g = c.createGain();
  g.gain.value = level;
  const comp = c.createDynamicsCompressor();
  g.connect(comp).connect(c.destination);
  return g;
}

function tone(c: BaseAudioContext, dest: AudioNode, t: number, f: number, dur: number, type: OscillatorType = 'sine', level = 0.4, glideTo?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur * 0.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Pluie de pièces : une dizaine de « tintements » métalliques qui tombent. */
function pieces(c: BaseAudioContext, at: number) {
  const m = out(c, 0.9);
  let t = at;
  for (let i = 0; i < 11; i++) {
    const f = 2400 + ((i * 937) % 1600);
    tone(c, m, t, f, 0.18, 'triangle', 0.35);
    tone(c, m, t, f * 1.51, 0.12, 'sine', 0.18);
    t += 0.045 + ((i * 17) % 5) * 0.012;
  }
  tone(c, m, t + 0.05, 3136, 0.9, 'sine', 0.3);
}

/** Succès : petit arpège montant brillant. */
function succes(c: BaseAudioContext, at: number) {
  const m = out(c, 0.85);
  [1047, 1319, 1568, 2093].forEach((f, i) => {
    tone(c, m, at + i * 0.09, f, 0.5 + i * 0.1, 'sine', 0.4);
    tone(c, m, at + i * 0.09, f * 2, 0.25, 'sine', 0.08);
  });
}

/** Level up façon jeu vidéo 8 bits. */
function arcade(c: BaseAudioContext, at: number) {
  const m = out(c, 0.6);
  [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(c, m, at + i * 0.07, f, 0.09, 'square', 0.35));
  tone(c, m, at + 0.5, 1568, 0.45, 'square', 0.3);
}

/** Clochette douce, discrète. */
function cloche(c: BaseAudioContext, at: number) {
  const m = out(c, 1);
  tone(c, m, at, 1760, 1.4, 'sine', 0.4);
  tone(c, m, at, 1760 * 2.76, 0.6, 'sine', 0.08);
  tone(c, m, at + 0.16, 2637, 1.2, 'sine', 0.3);
}

export const SYNTHS: Record<Exclude<SoundId, 'perso'>, (c: BaseAudioContext, at: number) => void> = {
  kaching: (c, at) => render(c, at),
  pieces,
  succes,
  arcade,
  cloche,
};
