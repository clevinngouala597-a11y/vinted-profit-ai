# Vinted Profit AI

Application mobile (PWA installable sur iPhone) de comptabilité, de stock et de rentabilité pour l'achat-revente sur Vinted.

**Version 0.2 — Phases 1 et 2 fonctionnelles.** Les données réelles sont enregistrées sur l'appareil et persistent après fermeture.

## Fonctionnalités opérationnelles

- **Configuration initiale** : statut, date de début, trésorerie de départ, objectif mensuel, bénéfice minimum par article, budget par achat, réserve de sécurité, part du bénéfice à réinvestir.
- **Accueil** :
  - bénéfice commercial et résultat après charges ;
  - chiffre d'affaires, achats, dépenses, trésorerie, valeur du stock, articles en stock et vendus, bénéfice par article, marge, ROI, montant à réinvestir et disponible ;
  - comparaison avec la période précédente, objectif du mois, graphique interactif, alertes, activité récente ;
  - périodes : 7 jours, 30 jours, mois, mois précédent, trimestre, année, période personnalisée ;
  - une définition de chaque indicateur, via le bouton « i ».
- **Achats** : article seul ou lot à prix global, frais communs répartis automatiquement, photos, statut de départ, alerte de budget.
- **Stock** :
  - recherche, filtres (statut, ancienneté, sans prix, catégorie) et tris (récence, rentabilité, valeur, durée) ;
  - fiche article avec galerie photo (compression automatique, photo principale, suppression confirmée) ;
  - statuts aux transitions contrôlées ;
  - correction de coût tracée, article perdu ou retiré compté en perte.
- **Ventes** :
  - un ou plusieurs articles, bénéfice calculé en direct avec alerte de vente à perte ;
  - paiement en attente ou reçu, suivi expédiée puis terminée, annulation ;
  - retours et remboursements partiels ou totaux, avec remise en stock seulement à la récupération ;
  - dépenses rattachées à une vente.
- **Dépenses** : catégories, justificatif photo ou PDF, détection des doublons, répartition par catégorie, annulation tracée.
- **Trésorerie** : solde confirmé, sommes en attente, réserve, budget d'achat disponible, historique des mouvements.
- **Bilan** : jour, mois (compte de résultat comparé au mois précédent, stock et trésorerie en fin de mois, bénéfice par catégorie et par marque) et année (mois par mois). Liste des opérations à vérifier.
- **Calculateur de prix** : coût de revient, bénéfice, marge, ROI, prix minimum pour un objectif, comparaison de 5 prix.
- **Objectifs mensuels** : chiffre d'affaires, bénéfice, nombre de ventes, marge minimale, budget d'achat maximal, stock maximal, trésorerie à conserver.
  - Pour chaque objectif : progression, reste à faire, rythme actuel et estimation de fin de mois (à partir du 7e jour).
  - Chaque mois garde ses propres objectifs : les modifier ne change jamais les mois passés.
- **Corrections tracées** : montants ou date d'une vente, avec ajustement de trésorerie et avant/après dans le journal.
- **Graphiques du bilan** : semaine par semaine, objectifs comparés aux résultats, valeur du stock en fin de mois.
- **Exports** (chaque fichier indique la période, la date de génération et les définitions) :
  - classeur **Excel** avec de vrais nombres, formats €/%/dates, totaux, filtres et onglet de définitions ;
  - **bilan mensuel PDF** : compte de résultat comparé, stock, trésorerie, objectifs, catégories, ventes, dépenses ;
  - fichiers **CSV** : rapport mensuel, ventes, achats, dépenses, mouvements, inventaire.
- **Sauvegarde et restauration** complètes en JSON, photos comprises. Journal des opérations et effacement des données confirmé deux fois.
- **Hors ligne** : l'application s'ouvre sans réseau une fois installée.

Les règles de calcul sont détaillées dans [docs/methodes-de-calcul.md](docs/methodes-de-calcul.md).

## Pas encore disponible

Rien de ce qui suit n'est simulé dans l'application : ces fonctions sont simplement absentes.

| Fonction | Phase | Ce qu'il faut |
|---|---|---|
| Comptes utilisateurs et synchronisation entre appareils | 2 | Un projet Supabase (gratuit). En attendant, utiliser la sauvegarde JSON. |
| Assistant IA, suggestions de prix, titres et descriptions | 3 | Une clé API Claude, appelée depuis un backend (jamais depuis le téléphone) |
| Import CSV, OCR des justificatifs | 4 | OCR : service IA ou bibliothèque locale |
| Prévisions, module fiscal, notifications | 4 | Sources officielles (impots.gouv.fr, urssaf.fr) |

Aucune connexion à Vinted n'existe ni n'est simulée. Vinted ne propose pas d'API publique pour les commandes. Les données viennent de la saisie manuelle et, plus tard, de l'import de fichiers. Le mot de passe Vinted n'est jamais demandé.

## Installation locale

Prérequis : Node.js 20 ou plus.

```bash
npm install
npm run dev        # http://localhost:5173/vinted-profit-ai/
npm test           # tests du moteur financier (cas A à F du cahier des charges, etc.)
npm run build      # vérification TypeScript + build de production dans dist/
```

**Variables d'environnement** : aucune n'est nécessaire pour cette version. `VITE_BASE` permet de changer le chemin de publication (par défaut `/vinted-profit-ai/`).

## Déploiement (GitHub Pages)

Le workflow `.github/workflows/deploy.yml` lance les tests, construit l'application et la publie à chaque push sur `main`.

À faire une seule fois : dans le dépôt GitHub, **Settings → Pages → Source : GitHub Actions**.

L'application est ensuite servie à l'adresse `https://<compte>.github.io/vinted-profit-ai/`.

## Installer sur iPhone

1. Ouvrir l'adresse de l'application dans **Safari**.
2. Bouton Partager, puis **Sur l'écran d'accueil**.
3. Ouvrir l'application depuis l'icône : plein écran, fonctionne hors ligne.

## Sauvegarde

Les données sont stockées dans le navigateur de l'appareil (IndexedDB). Effacer les données de Safari ou désinstaller l'application les supprime.

1. Menu de l'accueil, puis **Exports et sauvegarde**, puis **Créer une sauvegarde** (photos incluses si la case est cochée).
2. Enregistrer le fichier `.json` dans Fichiers ou iCloud Drive.
3. Pour restaurer, sur le même appareil ou un autre : **Restaurer une sauvegarde**. Les données actuelles sont remplacées, après confirmation.

Rythme conseillé : une sauvegarde par semaine, et avant toute mise à jour importante.

## Base de données et migrations

Le schéma IndexedDB est déclaré dans `src/lib/db.ts` (Dexie). Versions : `version(1)` pour le schéma initial, `version(2)` pour l'ajout de la table `goals` (migration automatique, sans perte). Pour faire évoluer le schéma, il faut ajouter un `this.version(2).stores({...}).upgrade(...)` : les données existantes sont alors migrées automatiquement à l'ouverture.

Tables :
- réglages (`settings`) ;
- articles (`items`) ;
- achats (`purchases`, `purchaseLines`) ;
- ventes (`sales`, `saleLines`) ;
- remboursements (`refunds`) ;
- dépenses (`expenses`) ;
- mouvements de trésorerie (`transactions`) ;
- mouvements de stock (`inventoryMovements`) ;
- pièces jointes (`attachments`) ;
- journal (`auditLogs`) ;
- objectifs mensuels (`goals`).

## Structure

```
src/lib/money.ts      montants en centimes, arrondis, répartition exacte
src/lib/engine.ts     moteur financier (fonctions pures)
src/lib/actions.ts    opérations d'écriture validées, transactionnelles et journalisées
src/lib/db.ts         schéma de la base locale
src/lib/exports.ts    tableaux d'export, CSV, sauvegarde et restauration
src/lib/office.ts     Excel et PDF (chargés seulement au moment d'exporter)
src/lib/journal.ts    mise en forme lisible du journal
src/screens/          écrans
src/ui/               composants, icônes, graphiques
tests/                tests unitaires et d'intégration (base IndexedDB simulée)
docs/                 cahier des charges, méthodes de calcul
```
