/**
 * Prix d'achat habituels : un prix par catégorie et des modèles personnalisés (« Nike Air Force 1 · 15 € »).
 *
 * Ils servent UNIQUEMENT à pré-remplir une saisie (nouvel achat, prix d'un article créé par la synchro).
 * Le prix retenu est ensuite enregistré comme d'habitude, sur l'article : modifier ou supprimer un modèle
 * ne change jamais le coût d'un article existant ni le bénéfice d'une vente déjà enregistrée.
 */
import type { Cents } from './money';
import { normTitle } from './vinted/parse';
import type { Settings } from './types';

export interface CostModel {
  id: string;
  /** nom affiché, ex. « Nike Air Force 1 » */
  name: string;
  /** mots à retrouver dans un titre Vinted (facultatif ; sinon le nom), séparés par des virgules */
  keywords: string;
  /** catégorie proposée avec le modèle (facultative) */
  category: string;
  price: Cents;
}

export interface CostSuggestion {
  price: Cents;
  source: 'modele' | 'categorie';
  /** « Nike Air Force 1 » ou « Sweats et pulls » */
  label: string;
  modelId?: string;
}

type CostSettings = Pick<Settings, 'categoryPrices' | 'costModels'>;

const words = (s: string) => normTitle(s).split(' ').filter((w) => w.length > 1);

/** Variantes recherchées pour un modèle : chaque groupe de mots-clés, ou son nom. */
function patterns(m: CostModel): string[][] {
  const groups = (m.keywords || m.name).split(',').map(words).filter((g) => g.length);
  return groups.length ? groups : [words(m.name)];
}

/**
 * Modèle correspondant à un titre : tous les mots d'un de ses groupes figurent dans le titre.
 * En cas de plusieurs correspondances, le plus précis (le plus de mots) l'emporte.
 */
export function matchModel(models: CostModel[], title: string): CostModel | null {
  const t = new Set(words(title));
  let best: { m: CostModel; n: number } | null = null;
  for (const m of models) {
    for (const p of patterns(m)) {
      if (p.length && p.every((w) => t.has(w)) && (!best || p.length > best.n)) best = { m, n: p.length };
    }
  }
  return best?.m ?? null;
}

/** Prix habituel d'une catégorie (null : aucun). */
export function categoryPrice(s: CostSettings, category: string): Cents | null {
  const v = s.categoryPrices?.[category];
  return typeof v === 'number' && v >= 0 ? v : null;
}

/** Prix proposé : modèle reconnu dans le titre, sinon prix de la catégorie. */
export function suggestCost(s: CostSettings, p: { title?: string; category?: string }): CostSuggestion | null {
  const m = p.title ? matchModel(s.costModels ?? [], p.title) : null;
  if (m) return { price: m.price, source: 'modele', label: m.name, modelId: m.id };
  const c = p.category ? categoryPrice(s, p.category) : null;
  return c !== null ? { price: c, source: 'categorie', label: p.category! } : null;
}
