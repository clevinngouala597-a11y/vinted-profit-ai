# CNG Vinted

_Nom de projet : Vinted Profit AI. Nom affiché sur l'iPhone : **CNG Vinted**._

Application mobile (PWA installable sur iPhone) de comptabilité, de stock et de rentabilité pour l'achat-revente sur Vinted.

**Version 0.4 — Phases 1, 2 et 4 fonctionnelles** (la phase 3, l'assistant IA, attend une clé API). Les données réelles sont enregistrées sur l'appareil et persistent après fermeture.

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
- **Synchro automatique avec Gmail** (menu → Synchro Vinted) : à chaque ouverture, l'app lit tes e-mails Vinted et enregistre seule :
  - les ventes, avec le paiement en attente ;
  - le paiement reçu, avec le montant réellement viré ;
  - les expéditions et les annulations ;
  - les factures de boost, en dépenses ;
  - les achats faits sur Vinted, frais de port et protection inclus dans le coût.

  Une vente dont l'article n'est pas reconnu dans le stock va dans « À valider » : tu choisis l'article, ou tu indiques son coût. Les paiements et expéditions de cette vente s'appliquent ensuite seuls. Une vente déjà saisie à la main n'est jamais enregistrée deux fois.

  Fonctionnement :
  - un script Google Apps Script, installé une fois dans **ton** compte Google, lit uniquement les e-mails Vinted utiles ;
  - il ne répond qu'avec une clé secrète générée par l'app ;
  - le mot de passe Vinted n'est jamais utilisé, et rien ne passe par un serveur tiers.
- **Import CSV** (articles avec achat et vente éventuelle, ou dépenses) :
  - association automatique des colonnes, modifiable, avec aperçu ;
  - validation ligne par ligne, rapport des rejets téléchargeable ;
  - doublons ignorés par défaut, confirmation avant tout enregistrement ;
  - modèles à remplir fournis.
- **OCR des justificatifs** : prends le ticket en photo, l'app propose le montant total, la date et le magasin, avec un niveau de confiance. Tu vérifies avant d'enregistrer.
  - La lecture se fait **dans le téléphone** (tesseract.js) : l'image n'est envoyée nulle part.
  - Au premier usage, le moteur et le dictionnaire français (environ 2 Mo) sont téléchargés depuis le CDN jsDelivr, puis gardés en cache.
- **Prévisions** à 30, 60 et 90 jours : scénarios prudent, central et optimiste à partir des semaines récentes, avec hypothèses et limites affichées. Pas de prévision tant que l'historique est trop court.
- **Centre de notifications** (cloche sur l'accueil) : stock ancien, justificatifs manquants, ventes à perte, paiements ou expéditions en retard, retours non récupérés, objectifs, données manquantes, écart avec les prévisions, rappels fiscaux, sauvegardes.
  - Chaque type d'alerte peut être désactivé.
  - Une alerte masquée ne revient que si la situation change.
- **Fiscalité** :
  - recettes encaissées (distinctes du bénéfice) et compteur DAC7 ;
  - selon le statut : alerte achat-revente pour un particulier, ou estimation des cotisations, du versement libératoire et de la base imposable pour un micro-entrepreneur ;
  - seuils de TVA et de la micro-entreprise, périodes de déclaration Urssaf ;
  - **livre des recettes**, **registre des achats** et dossier Excel pour l'expert-comptable ;
  - chaque règle cite sa source officielle et sa date de vérification ;
  - l'app ne déclare et ne paie jamais rien.
- **Hors ligne** : l'application s'ouvre sans réseau une fois installée.

Les règles de calcul sont détaillées dans [docs/methodes-de-calcul.md](docs/methodes-de-calcul.md).

## Pas encore disponible

Rien de ce qui suit n'est simulé dans l'application : ces fonctions sont simplement absentes.

| Fonction | Phase | Ce qu'il faut |
|---|---|---|
| Comptes utilisateurs et synchronisation entre appareils | 2 | Un projet Supabase (gratuit). En attendant, utiliser la sauvegarde JSON. |
| Assistant IA, suggestions de prix, titres et descriptions | 3 | Une clé API Claude, appelée depuis un backend (jamais depuis le téléphone) |
| Synchro sans ouvrir l'app (en arrière-plan) | — | Un serveur ; aujourd'hui la synchro se fait à chaque ouverture |
| Notifications sur l'écran verrouillé (push) | — | Un serveur d'envoi ; les alertes restent pour l'instant dans l'application |
| Mise à jour automatique des règles fiscales | — | Les règles sont datées dans `src/lib/fiscal.ts` et doivent être revérifiées chaque année |

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

Le workflow `.github/workflows/deploy.yml` lance les tests, construit l'application, puis publie le résultat sur la branche `gh-pages` à chaque push sur `main`. GitHub Pages sert cette branche.

Si la page n'apparaît pas, vérifie une fois dans **Settings → Pages** que la source est « Deploy from a branch », branche `gh-pages`, dossier `/ (root)`.

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

Le schéma IndexedDB est déclaré dans `src/lib/db.ts` (Dexie). Versions : `version(1)` pour le schéma initial, `version(2)` pour la table `goals`, `version(3)` pour la table `notifications` (alertes masquées), `version(4)` pour la table `syncedEmails` (e-mails Vinted déjà lus). Les migrations sont automatiques et sans perte ; les réglages d'une version antérieure reçoivent les nouvelles valeurs par défaut. Pour faire évoluer le schéma, il faut ajouter un `this.version(2).stores({...}).upgrade(...)` : les données existantes sont alors migrées automatiquement à l'ouverture.

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
- objectifs mensuels (`goals`) ;
- notifications masquées (`notifications`) ;
- e-mails Vinted synchronisés (`syncedEmails`).

## Structure

```
src/lib/money.ts      montants en centimes, arrondis, répartition exacte
src/lib/engine.ts     moteur financier (fonctions pures)
src/lib/actions.ts    opérations d'écriture validées, transactionnelles et journalisées
src/lib/db.ts         schéma de la base locale
src/lib/exports.ts    tableaux d'export, CSV, sauvegarde et restauration
src/lib/office.ts     Excel et PDF (chargés seulement au moment d'exporter)
src/lib/journal.ts    mise en forme lisible du journal
src/lib/importer.ts   import CSV (lecture, association des colonnes, validation, doublons)
src/lib/receipt.ts    OCR des tickets et extraction montant / date / magasin
src/lib/forecast.ts   prévisions à 30, 60 et 90 jours
src/lib/notifications.ts  calcul des alertes
src/lib/fiscal.ts     règles fiscales sourcées, recettes, DAC7, estimations
src/lib/vinted/       synchro Gmail : lecture des e-mails Vinted, association au stock, script Google
src/screens/          écrans
src/ui/               composants, icônes, graphiques
tests/                tests unitaires et d'intégration (base IndexedDB simulée)
docs/                 cahier des charges, méthodes de calcul
```
