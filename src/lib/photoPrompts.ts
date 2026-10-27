/**
 * Générateur de prompts photo (inspiré de « Vinted Prompt ») : à coller dans une IA d'image AVEC la vraie
 * photo de l'article, pour obtenir une photo nette et homogène, sans modifier l'article lui-même
 * (les acheteurs doivent recevoir exactement ce qu'ils voient).
 */
export const MODES = [
  { id: 'plat', label: 'Photo à plat', sub: 'Flat lay sur fond', emoji: '🧺' },
  { id: 'mannequin', label: 'Mannequin couture', sub: 'Portée sur buste', emoji: '🪡' },
  { id: 'miroir', label: 'Selfie miroir', sub: 'Portée, naturelle', emoji: '🪞' },
] as const;

export const VIEWS = [
  { id: 'face', label: 'Face', emoji: '⬆️', en: 'front view, whole item visible' },
  { id: 'dos', label: 'Dos', emoji: '⬇️', en: 'back view, whole item visible' },
  { id: 'etiquette', label: 'Étiquette', emoji: '🏷️', en: 'close-up of the brand and size label, text perfectly readable' },
  { id: 'detail', label: 'Détail', emoji: '🔍', en: 'close-up of a characteristic detail (fabric texture, logo, stitching)' },
  { id: 'cote', label: 'Côté', emoji: '↔️', en: 'side view' },
  { id: 'defaut', label: 'Défaut', emoji: '⚠️', en: 'clear close-up of the visible defect, shown honestly, not hidden or retouched' },
  { id: 'interieur', label: 'Intérieur sac', emoji: '👜', en: 'inside of the bag, compartments visible' },
  { id: 'fermoir', label: 'Fermoir', emoji: '🔒', en: 'close-up of the clasp / zip hardware' },
  { id: 'bijou', label: 'Bijou face', emoji: '💍', en: 'front view of the jewelry piece' },
  { id: 'macro', label: 'Bijou macro', emoji: '✨', en: 'macro shot of the jewelry details' },
] as const;

export const BACKGROUNDS = [
  { id: 'parquet', label: 'Parquet bois', en: 'light natural wooden parquet floor' },
  { id: 'carrelage', label: 'Carrelage blanc', en: 'clean white tiles' },
  { id: 'beton', label: 'Béton gris', en: 'smooth light grey concrete' },
  { id: 'lin', label: 'Lin beige', en: 'beige linen fabric' },
  { id: 'moquette', label: 'Moquette neutre', en: 'neutral light carpet' },
  { id: 'auto', label: 'Auto (contraste)', en: '' },
  { id: 'noir', label: 'Noir mat', en: 'matte black surface' },
  { id: 'velours', label: 'Velours noir', en: 'black velvet' },
  { id: 'carrelage-noir', label: 'Carrelage noir', en: 'black tiles' },
  { id: 'beton-noir', label: 'Béton noir granuleux', en: 'textured dark concrete' },
] as const;

export const LIGHTS = [
  { id: 'naturelle', label: 'Lumière naturelle', en: 'soft natural daylight from a window' },
  { id: 'chaude', label: 'Lumière chaude', en: 'warm soft indoor light' },
  { id: 'uniforme', label: 'Lumière uniforme', en: 'even, shadowless diffuse light' },
  { id: 'contrejour', label: 'Contre-jour doux', en: 'gentle backlight with soft fill' },
] as const;

export const STYLES = [
  { id: 'spontane', label: 'Spontané', en: 'casual smartphone photo, slightly imperfect framing, authentic second-hand marketplace look' },
  { id: 'soigne', label: 'Soigné & naturel', en: 'neat smartphone photo, item carefully smoothed and centered, natural and authentic, not a studio shot', recommended: true },
  { id: 'semipro', label: 'Clean semi-pro', en: 'clean semi-professional product photo, sharp, well composed, still realistic' },
] as const;

export interface PromptInput {
  mode: (typeof MODES)[number]['id'];
  type: string;
  color: string;
  brand: string;
  condition: string;
  views: string[];
  background: (typeof BACKGROUNDS)[number]['id'];
  light: (typeof LIGHTS)[number]['id'];
  style: (typeof STYLES)[number]['id'];
}

const DARK = /(noir|black|marine|navy|bordeaux|anthracite|kaki fonc|marron fonc|bleu nuit|charbon)/i;

/** Fond « auto » : clair pour un article foncé, foncé pour un article clair. */
export function autoBackground(color: string): string {
  return DARK.test(color) ? 'light natural wooden parquet floor' : 'matte black surface';
}

export function buildPrompts(p: PromptInput): { view: string; prompt: string }[] {
  const bg = p.background === 'auto' ? autoBackground(p.color) : BACKGROUNDS.find((b) => b.id === p.background)!.en;
  const light = LIGHTS.find((l) => l.id === p.light)!.en;
  const style = STYLES.find((s) => s.id === p.style)!.en;
  const item = [p.color, p.brand, p.type].filter((x) => x.trim()).join(' ') || 'clothing item';
  const scene =
    p.mode === 'plat' ? `laid flat (flat lay, top-down view) on ${bg}`
    : p.mode === 'mannequin' ? `worn on a neutral tailor's dressmaker mannequin (bust form), in front of ${bg}`
    : `worn by a person taking a casual mirror selfie in a bright, tidy room, face hidden by the phone, ${bg} visible`;
  const views = p.views.length ? p.views : ['face'];
  return views.map((v) => {
    const view = VIEWS.find((x) => x.id === v)!;
    return {
      view: view.label,
      prompt: `Using the attached photo of my real ${item}${p.condition ? ` (condition: ${p.condition})` : ''}, create a realistic photo for a Vinted listing: the item ${scene}. Shot: ${view.en}. Lighting: ${light}. Style: ${style}.
Keep the item EXACTLY identical to the attached photo: same colors, shape, size proportions, fabric texture, prints, logos, labels and any wear or defects. Do not add, remove, fix or embellish anything on the item. No text, no watermark, no props covering the item. Vertical 4:5 format.`,
    };
  });
}
