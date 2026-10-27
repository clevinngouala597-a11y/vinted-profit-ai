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

## Corrections et traçabilité

- Toute opération est enregistrée dans le journal (`auditLogs`).
- Une correction de coût met à jour l'achat et crée un **ajustement de trésorerie**. Rien n'est supprimé silencieusement.
- Les ventes annulées et remboursées restent consultables. Une dépense annulée laisse son mouvement de trésorerie marqué « annulé » et une trace dans le journal.
