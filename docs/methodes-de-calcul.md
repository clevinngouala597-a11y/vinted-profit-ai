# Méthodes de calcul

Toutes les règles ci-dessous sont implémentées dans `src/lib/engine.ts` (fonctions pures) et vérifiées par `tests/engine.test.ts`. L'interface n'effectue aucun calcul financier en dehors de ce moteur.

## Montants et arrondis

- Les montants sont stockés en **centimes d'euro entiers**. Aucun calcul financier n'utilise de flottant en euros.
- Saisie : « 12,5 », « 12.50 » ou « 1 234,56 € » sont acceptés. Au-delà de deux décimales, arrondi **demi vers l'extérieur** (1,005 € → 1,01 €).
- Pourcentages : arrondis à 2 décimales selon la même règle. Si le dénominateur est nul ou négatif, le résultat est **« non applicable »**.
- Répartitions (lots, ventes groupées) : méthode du **plus fort reste**. La somme des parts est toujours exactement égale au total, au centime près.

## Coût de revient

```
Coût de revient = prix d'achat attribué + frais d'achat attribués
```

**Lot acheté avec un prix global** : le prix est réparti au prorata du prix de vente souhaité de chaque article. S'il manque un prix souhaité, la répartition se fait **à parts égales** (aucun article ne peut recevoir un coût nul).

**Frais communs d'un achat** (livraison, protection acheteur, trajet) : ils sont répartis au prorata du prix attribué à chaque article, ou à parts égales si tous les prix sont nuls.

## Bénéfice commercial d'une vente

```
Bénéfice = montant encaissé
         − remboursements
         − coût de revient des articles non récupérés
         − frais à la charge du vendeur − emballage − autres coûts
         − dépenses rattachées à la vente − frais de retour
```

- **Montant encaissé** : ce que le vendeur reçoit réellement. Les frais payés par l'acheteur (protection, livraison) n'en font pas partie.
- **Frais de plateforme** : déduits seulement s'ils sont réellement supportés par le vendeur et pas déjà retirés du montant encaissé.
- **Vente groupée** : le montant et les frais sont répartis au prorata du prix souhaité de chaque article, à défaut au prorata de leur coût.
- **Vente annulée** : aucun revenu ni coût de revient, mais les frais déjà engagés restent comptés en charges.

## Indicateurs d'une période

Chaque opération produit des écritures datées, puis on additionne celles de la période.

| Indicateur | Définition |
|---|---|
| Chiffre d'affaires | Montants encaissés (date de la vente) − remboursements (date du remboursement) |
| Coût des articles vendus | Coût de revient à la date de vente, repris à la date de récupération en cas de retour |
| Bénéfice commercial | CA − coût des articles vendus − coûts attribuables aux ventes |
| Résultat estimé | Bénéfice commercial − dépenses générales − articles perdus ou retirés |
| Achats | Achats de stock payés sur la période (information, **pas une charge**) |
| Marge | Bénéfice commercial ÷ CA × 100 |
| ROI | Bénéfice commercial ÷ coût des articles vendus × 100 |

**Pas de double comptabilisation** : un achat de stock n'est jamais une charge. Il devient du coût de revient au moment de la vente, ou une perte si l'article est déclaré perdu ou retiré. Une dépense rattachée à une vente compte comme coût de cette vente, et non en frais généraux.

## Stock

- Un article est en stock s'il est acheté, à préparer, prêt, en vente, réservé ou retourné.
- Sa valeur est comptée **au coût de revient**, séparément du CA et de la trésorerie.
- Le bénéfice potentiel (prix souhaité − coût) est une estimation et **n'est jamais inclus** dans le bénéfice réalisé.
- Retour : l'article ne revient en stock qu'**après confirmation de sa récupération**.

## Trésorerie et réinvestissement

```
Trésorerie confirmée     = solde de départ + encaissements confirmés − décaissements confirmés
Disponible pour acheter  = trésorerie confirmée − sorties en attente − réserve de sécurité   (minimum 0)
À réinvestir             = min(disponible, bénéfice commercial du mois × % choisi)
```

- Une vente dont le paiement n'est pas encore reçu reste **en attente** : elle n'entre pas dans la trésorerie.
- Un remboursement avant paiement réduit la somme attendue, sans créer de second mouvement.
- La valeur du stock n'est jamais ajoutée à la trésorerie.

## Objectifs

- Chaque mois a ses propres objectifs.
  - Un mois sans objectifs reprend ceux du dernier mois renseigné, puis, à défaut, la configuration initiale (bénéfice mensuel, réserve).
  - Modifier un mois ne change jamais les mois passés.
- **Objectifs minimums** (chiffre d'affaires, bénéfice, ventes, marge, trésorerie) : « reste » = cible − réalisé.
- **Objectifs maximums** (budget d'achat, stock) : « dépassé » dès que le réalisé dépasse la cible.
- **Estimation de fin de mois** : réalisé ÷ jours écoulés × jours du mois. Elle n'est affichée qu'à partir du 7e jour du mois en cours, et pas pour la marge, le stock ni la trésorerie (ce ne sont pas des cumuls).

## Corrections et traçabilité

- Toute opération est enregistrée dans le journal (`auditLogs`).
- Une correction de coût met à jour l'achat et crée un **ajustement de trésorerie**. Rien n'est supprimé silencieusement.
- **Correction d'une vente** (montants ou date) : la répartition par article est recalculée avec les mêmes poids.
  - Si le paiement est en attente : la somme attendue est modifiée.
  - Sinon : la différence passe par un mouvement d'ajustement daté du jour de la correction.
  - Une raison est obligatoire, et l'avant/après est inscrit au journal.
  - Le montant encaissé ne peut pas descendre sous le total déjà remboursé.
- Les ventes annulées et remboursées restent consultables. Une dépense annulée laisse son mouvement de trésorerie marqué « annulé » et une trace dans le journal.

## Prévisions

- **Historique** : jusqu'à 12 semaines complètes, à partir de la première opération réelle (achat ou vente), en s'arrêtant à la veille.
  - Il faut au moins 4 semaines et 5 ventes ; sinon, aucune prévision n'est affichée.
- **Pour chaque semaine** : chiffre d'affaires, bénéfice commercial, dépenses générales (pertes comprises) et flux de trésorerie confirmé.
- **Scénarios** : central = moyenne hebdomadaire, prudent = 1er quartile, optimiste = 3e quartile. Chacun est multiplié par le nombre de semaines de l'horizon (30, 60 ou 90 jours ÷ 7).
- **Résultat** = bénéfice du scénario − dépenses générales moyennes.
- **Trésorerie finale** = solde confirmé + flux du scénario + sorties en attente. Les paiements en attente sont ajoutés, sauf dans le scénario prudent.
- **Alerte d'écart** (à partir du 10e jour du mois) : le bénéfice du mois est comparé au rythme des semaines précédant le mois. L'alerte se déclenche s'il est sous le scénario prudent.

## Fiscalité

- **Recettes encaissées** = ventes dont le paiement est confirmé (à la date du paiement) − remboursements + corrections du montant encaissé.
  - C'est la base des estimations du micro-entrepreneur. Ce n'est pas le bénéfice commercial.
- **Compteur DAC7** : ventes non annulées et montants encaissés de l'année civile.
  - La plateforme transmet à partir de 30 ventes, ou dès que le montant dépasse 2 000 €.
  - C'est un compteur approché, d'après les saisies.
- **Micro-entrepreneur** :
  - cotisations = recettes × 12,3 % ; formation professionnelle = recettes × 0,1 % ;
  - versement libératoire = recettes × 1 %, si l'option est cochée ;
  - sans versement libératoire, revenu à déclarer = recettes × (1 − 71 %).
- **Particulier ou autre statut** : aucun taux n'est appliqué.
- Les règles chiffrées, leurs sources et leur date de vérification sont regroupées dans `src/lib/fiscal.ts`.

## Import CSV

- Un article importé crée un achat (source « Import CSV », ligne d'origine dans les notes).
  - Si la date et le montant de vente sont présents, il crée aussi une vente dont le paiement est reçu, marquée terminée.
  - Le calcul est identique à une saisie manuelle.
- **Lignes rejetées** : nom, date ou prix illisible ; date future ; vente avant l'achat ; montant de vente sans date (ou l'inverse).
- **Doublons** :
  - article : même nom, même date d'achat et même prix ;
  - dépense : même montant, même fournisseur ou même catégorie, à un jour près.
  - Ils sont ignorés par défaut.
- **Formats acceptés** :
  - dates : 31/12/2026, 31/12/26, 31.12.2026 ou 2026-12-31 ;
  - montants : « 12,50 », « 12.50 », « 1 234,56 € », « 1.234,56 » ou « 1,234.56 ».

## Synchronisation des e-mails Vinted

| E-mail Vinted | Effet dans l'application |
|---|---|
| « Ton article s'est vendu ! » | Vente à la date de l'e-mail. Le prix payé par l'acheteur pour l'article devient le montant encaissé. Paiement en attente. |
| « La transaction est finalisée » | Paiement reçu à la date de l'e-mail, vente terminée. Si le montant viré diffère, la vente est corrigée, avec une trace au journal. |
| « Commande mise à jour… acheminement » | Vente marquée expédiée. |
| « Commande mise à jour… transaction annulée » | Vente annulée, article remis en vente (si le paiement n'a pas été reçu). |
| « … : ta facture » (boost, vitrine) | Dépense « Frais de plateforme », fournisseur Vinted. |
| « Ton reçu pour la commande » | Achat. Coût = montant payé : prix de l'article + frais de port, protection et réduction répartis en frais. |
| « La commande … a été remboursée » | « À valider » : l'achat est à corriger à la main. |

- **Association à un article** :
  - même titre (accents, ponctuation et taille ignorés) ;
  - ou au moins 75 % de mots en commun ;
  - ou tous les mots du nom court (au moins 2) présents dans le titre Vinted.
- **Articles identiques en stock** : le plus ancien part en premier.
- **Prudence** :
  - une vente déjà saisie à la main (même article, à 3 jours près) est reconnue et n'est pas recréée ;
  - un e-mail n'est lu qu'une fois ;
  - une seule synchro tourne à la fois ;
  - les e-mails antérieurs à la date choisie ne sont pas importés.

### Mode automatique (par défaut)

- **Aucune confirmation demandée.** Un article vendu qui n'est pas dans le stock est créé tout seul, avec un prix d'achat à 0 € marqué « à indiquer ».
- **Tant que ce prix n'est pas indiqué**, le bénéfice est surestimé. L'accueil affiche le nombre d'articles concernés. Une fois le prix saisi, tout est recalculé comme s'il avait été saisi dès l'achat : achat, sortie de trésorerie à la date d'achat, coût de revient de la vente.
- **Ventes sans paiement.** Une vente sans « transaction finalisée » ni annulation après 30 jours est considérée comme remboursée : Vinted n'envoie pas toujours d'e-mail dans ce cas.
  - Lors de l'import de l'historique, elle n'est pas comptée.
  - Si elle a déjà été enregistrée, elle est annulée automatiquement.
  - Si le paiement arrive malgré tout plus tard, la vente est rétablie.
- **Rattachement des e-mails.** Chaque paiement, annulation ou expédition est rattaché à la dernière vente ouverte du même article. Un article revendu plusieurs fois est donc suivi correctement.
