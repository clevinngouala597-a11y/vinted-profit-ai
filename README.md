# Vinted Profit AI

Application mobile-first (PWA) de comptabilité, d'achat-revente et de gestion financière pour les revendeurs Vinted.

**Statut :** cadrage — le code arrive avec la Phase 1 (MVP).

## Objectifs
- Bénéfice réel par article (coût de revient, marge, ROI)
- Suivi des achats, ventes, dépenses, retours et remboursements
- Valeur du stock et trésorerie réellement disponible, toujours séparées
- Budget de réinvestissement, objectifs et bilans exportables
- Assistant IA qui calcule à partir des données enregistrées, sans inventer de chiffres

## Feuille de route
1. **MVP** — interface sombre, comptes, tableau de bord, articles/photos, achats, ventes, stock, dépenses
2. **Comptabilité & analyses** — bilans, graphiques, exports, trésorerie, objectifs
3. **IA** — assistant, suggestions de prix, fiches produits
4. **Avancé** — import CSV, OCR, prévisions, module fiscal, notifications
5. **Validation & livraison**

## Stack envisagée
React + TypeScript, Tailwind CSS, Supabase (PostgreSQL, auth, stockage privé), PWA installable sur iPhone.

## Documentation
- [Cahier des charges complet](docs/cahier-des-charges.md)

> Aucune connexion à Vinted n'est utilisée : saisie manuelle et import de fichiers uniquement.
