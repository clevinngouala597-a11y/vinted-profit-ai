VINTED PROFIT AI — CAHIER DES CHARGES COMPLET

Application IA de comptabilité, d’achat-revente et de gestion financière spécialisée Vinted

Version : 1.0 — Spécification de développement

1. Vision du projet

Tu es une équipe complète composée d’un développeur full-stack senior, d’un ingénieur IA, d’un designer UI/UX spécialisé dans les applications financières, d’un expert en bases de données et d’un spécialiste de la comptabilité française.

Ta mission est de concevoir, développer, tester et livrer une véritable application appelée Vinted Profit AI.

Cette application est exclusivement destinée aux personnes qui achètent et revendent des vêtements et accessoires sur Vinted.

Elle doit réunir les fonctionnalités d’un comptable personnel, d’un gestionnaire de stock, d’un calculateur de rentabilité et d’un assistant IA.

L’utilisateur doit pouvoir gérer l’ensemble de son activité depuis son téléphone, sans avoir besoin de feuilles de calcul externes pour ses opérations courantes.

Objectifs prioritaires

1. Connaître le bénéfice réalisé sur chaque article.
2. Suivre toutes les dépenses et recettes.
3. Gérer les articles achetés, publiés, vendus, retournés et invendus.
4. Connaître la valeur du stock et son coût de revient.
5. Calculer la trésorerie réellement disponible.
6. Déterminer combien réinvestir dans de nouveaux articles.
7. Identifier les articles et catégories les plus rentables.
8. Automatiser les tâches répétitives avec l’intelligence artificielle.
9. Préparer des bilans et des exports comptables fiables.
10. Fournir une interface premium inspirée du tableau de bord FlipAI fourni comme référence visuelle.

Le projet doit aboutir à une application fonctionnelle, pas uniquement à une maquette, une démonstration ou un prototype avec des données fictives.

⸻

2. Identité visuelle et expérience utilisateur

2.1 Direction artistique

Créer une interface inspirée de l’application FlipAI présentée dans l’image de référence, sans copier son identité graphique exacte.

L’application doit donner une impression de qualité, de précision et de maîtrise financière.

Palette de couleurs

* Fond principal : noir profond, proche de #090B0A.
* Cartes : anthracite, proche de #141714.
* Bordures : gris foncé, proche de #292D29.
* Couleur principale : vert lumineux, proche de #63F77B.
* Texte principal : blanc cassé, proche de #F5F5F5.
* Texte secondaire : gris clair, proche de #A1A1AA.
* Alertes : orange pour les avertissements et rouge pour les erreurs importantes.

Le vert doit être réservé aux indicateurs positifs, aux bénéfices et aux actions principales. Une perte doit être clairement identifiable et ne jamais être présentée comme un gain.

Principes de conception

* Design minimaliste et premium.
* Interface mobile-first.
* Navigation fluide.
* Cartes financières avec coins arrondis.
* Graphiques élégants et lisibles.
* Typographie moderne.
* Icônes cohérentes.
* Animations discrètes.
* Mode sombre par défaut.
* Mode clair facultatif.
* Prise en charge du français et de l’euro.
* Dates au format français.
* Adaptation aux petits écrans, notamment aux iPhone.

Ne pas surcharger l’écran. Les informations les plus importantes doivent apparaître immédiatement sans obliger l’utilisateur à parcourir de nombreux menus.

2.2 Navigation principale

Créer cinq onglets fixes en bas de l’écran :

1. Accueil : tableau de bord financier.
2. Stock : articles, photos, coûts et statuts.
3. Ajouter : bouton central pour ajouter un achat, une vente ou une dépense.
4. Ventes : historique des ventes et commandes.
5. Bilan : analyses financières et rapports.

Ajouter un menu secondaire accessible depuis l’accueil pour les paramètres, l’assistant IA, les justificatifs, les objectifs, les exports et les réglages comptables.

2.3 Qualité de l’interface

Chaque page doit prévoir :

* Un état de chargement.
* Un état vide avec une explication claire.
* Des messages d’erreur compréhensibles.
* Des confirmations pour les opérations sensibles.
* Une validation des formulaires.
* Une navigation au clavier et des libellés accessibles.
* Une mise à jour immédiate des indicateurs après une opération validée.

Aucun bouton ne doit être purement décoratif.

⸻

3. Authentification et profil utilisateur

Créer un système de compte sécurisé.

Fonctionnalités :

* Création de compte.
* Connexion et déconnexion.
* Réinitialisation du mot de passe.
* Gestion de session.
* Suppression du compte.
* Export des données personnelles.
* Préférences d’affichage.
* Devise et fuseau horaire.
* Paramètres de notifications.

Créer un assistant de première configuration qui demande :

* Le nom de l’activité, facultatif.
* Le statut de l’activité : particulier, micro-entrepreneur ou autre statut pertinent.
* La date de début du suivi.
* Le budget initial.
* La trésorerie initiale.
* L’objectif de bénéfice mensuel.
* Le budget maximal d’achat.
* Le bénéfice minimum souhaité par article.
* Le pourcentage de bénéfice que l’utilisateur souhaite réinvestir.
* Les frais et charges qu’il souhaite suivre.

Ne pas supposer que l’utilisateur est automatiquement micro-entrepreneur. Les calculs comptables et fiscaux doivent s’adapter à sa situation réelle.

⸻

4. Tableau de bord financier

Créer un écran d’accueil affichant les indicateurs essentiels.

4.1 Indicateurs principaux

Afficher des cartes pour :

* Chiffre d’affaires de la période.
* Bénéfice commercial estimé.
* Résultat estimé après les charges enregistrées.
* Total des achats.
* Total des dépenses annexes.
* Trésorerie disponible.
* Valeur du stock au coût d’achat.
* Nombre d’articles en stock.
* Nombre d’articles vendus.
* Marge moyenne par article.
* Retour sur investissement.
* Montant prévu pour le réinvestissement.

Chaque indicateur doit comporter une définition accessible via une icône d’information.

L’utilisateur doit pouvoir sélectionner une période : 7 jours, 30 jours, mois en cours, mois précédent, trimestre, année ou période personnalisée.

Comparer les résultats à la période précédente lorsque les données permettent une comparaison pertinente.

4.2 Graphiques

Créer les visualisations suivantes :

* Évolution du chiffre d’affaires.
* Évolution du bénéfice commercial.
* Évolution des dépenses.
* Répartition des dépenses par catégorie.
* Ventes par catégorie de vêtements.
* Rentabilité par marque.
* Performance des ventes par semaine et par mois.
* Évolution de la valeur du stock.
* Comparaison entre objectifs et résultats.

Les graphiques doivent être interactifs et permettre de consulter les montants associés aux points de données.

Les périodes sans données ne doivent pas être remplacées artificiellement par des ventes.

4.3 Activité récente

Afficher les dernières opérations :

* Achats enregistrés.
* Ventes confirmées.
* Dépenses ajoutées.
* Retours et remboursements.
* Corrections comptables.
* Alertes importantes.

Chaque ligne doit permettre d’ouvrir le détail de l’opération.

⸻

5. Gestion complète des articles

Créer une base de données d’articles avec une fiche individuelle pour chaque vêtement ou accessoire.

5.1 Informations de l’article

Champs obligatoires ou facultatifs selon le cas :

* Identifiant unique.
* Nom de l’article.
* Catégorie.
* Marque.
* Taille.
* Couleur.
* État.
* Description.
* Photos.
* Date d’achat.
* Prix d’achat.
* Frais directement associés à l’achat.
* Coût de revient.
* Prix de vente souhaité.
* Prix de vente minimum.
* Bénéfice prévisionnel.
* Date de publication.
* Date de vente.
* Statut.
* Notes personnelles.
* Référence de l’annonce, si disponible.

Catégories initiales :

* T-shirts.
* Sweats et pulls.
* Vestes et manteaux.
* Pantalons et jeans.
* Shorts.
* Chaussures.
* Accessoires.
* Sacs.
* Autres vêtements.

L’utilisateur doit pouvoir ajouter ses propres catégories.

5.2 Statuts des articles

Prévoir les statuts suivants :

* À acheter.
* Acheté.
* À nettoyer ou préparer.
* Prêt à publier.
* En vente.
* Réservé.
* Vendu.
* Expédié.
* Terminé.
* Retourné.
* Remboursé.
* Retiré de la vente.

Définir des transitions cohérentes entre les statuts. Un article vendu ne doit plus être considéré comme disponible en stock.

Le statut « vendu » ne doit pas suffire à considérer la commande comme définitivement terminée lorsqu’un retour ou un remboursement reste possible.

5.3 Recherche et filtres

Permettre de rechercher et filtrer par :

* Nom.
* Marque.
* Taille.
* Catégorie.
* Statut.
* Prix d’achat.
* Prix de vente.
* Bénéfice prévisionnel.
* Rentabilité.
* Date d’achat.
* Nombre de jours en stock.

Ajouter le tri par rentabilité, date, valeur du stock et durée d’immobilisation.

5.4 Gestion des photos

Permettre :

* De prendre une photo depuis le téléphone.
* D’importer des images.
* De consulter une galerie.
* De modifier la photo principale.
* De supprimer une image avec confirmation.
* De compresser les fichiers sans dégradation excessive.

Prévoir un stockage sécurisé et limiter la taille des images.

⸻

6. Module d’achats

Créer une page permettant d’enregistrer chaque achat.

Un achat doit contenir :

* Date.
* Articles concernés.
* Prix payé.
* Quantités.
* Frais de déplacement attribuables.
* Autres frais d’approvisionnement.
* Source d’approvisionnement.
* Justificatif facultatif.
* Moyen de paiement, facultatif.
* Notes.

Un achat peut contenir plusieurs articles. Le système doit répartir les coûts communs selon une méthode documentée, par exemple proportionnellement à la valeur des articles, lorsque cette méthode est adaptée.

Pour chaque article, calculer :

Coût de revient = prix d’achat attribué + frais directs attribués.

Éviter de compter deux fois une même dépense.

Prévoir l’enregistrement des lots de vêtements achetés en une seule transaction, avec répartition du coût entre les différents articles.

Permettre de corriger une erreur tout en conservant une trace de la modification.

⸻

7. Module de ventes

Créer un écran de gestion des ventes.

Chaque vente doit pouvoir contenir :

* Identifiant de vente.
* Article ou articles concernés.
* Date de commande.
* Prix de vente.
* Réductions accordées par le vendeur.
* Montant réellement encaissé par le vendeur.
* Frais réellement supportés par le vendeur.
* Frais d’emballage.
* Autres coûts attribuables.
* Statut du paiement.
* Statut de la commande.
* Date d’expédition, facultative.
* Date de clôture.
* Retour ou remboursement éventuel.
* Notes et justificatifs.

Prévoir les statuts de commande : en attente, confirmée, expédiée, terminée, annulée, retournée et remboursée.

7.1 Calcul du bénéfice

Calculer le bénéfice commercial par vente selon la formule :

Bénéfice commercial = revenu vendeur retenu − coût de revient des articles vendus − autres coûts supportés par le vendeur.

Le revenu vendeur retenu doit correspondre au montant attribuable à la vente, après réductions et ajustements applicables.

Les frais payés par l’acheteur ne sont pas des revenus du vendeur.

Les frais de plateforme ne doivent être déduits que s’ils sont réellement supportés par le vendeur et ne sont pas déjà inclus dans un montant net.

Le coût d’achat d’un article ne doit être imputé au résultat qu’une seule fois.

En cas de vente groupée, répartir le prix et les frais entre les articles selon une méthode cohérente, traçable et documentée.

7.2 Gestion des retours

Lors d’un retour :

* Conserver l’historique de la vente initiale.
* Enregistrer le remboursement réel.
* Mettre à jour le stock après confirmation de la récupération de l’article.
* Actualiser le résultat et les frais.
* Ne pas effacer l’opération initiale.
* Signaler les coûts qui ne sont pas récupérables.

Les montants historiques et les ajustements doivent rester consultables.

⸻

8. Calculateur de prix et de rentabilité

Créer un calculateur permettant de simuler un prix de vente avant de publier une annonce.

L’utilisateur renseigne :

* Prix d’achat.
* Frais directs.
* Prix de vente envisagé.
* Frais estimés à la charge du vendeur.
* Bénéfice minimum recherché.

L’application calcule :

* Coût de revient.
* Bénéfice prévisionnel.
* Marge sur le prix de vente.
* Retour sur investissement.
* Prix minimum pour atteindre l’objectif.
* Comparaison entre plusieurs prix possibles.

Formules de référence :

Coût de revient = coût d’achat + frais directs attribuables.

Bénéfice prévisionnel = revenu vendeur estimé − coût de revient − autres coûts estimés.

Marge commerciale (%) = bénéfice commercial ÷ revenu vendeur × 100, si le revenu vendeur est positif.

ROI (%) = bénéfice commercial ÷ coût de revient × 100, si le coût de revient est positif.

Ne pas calculer un pourcentage si son dénominateur est nul. Afficher alors « non applicable ».

Le calculateur doit distinguer les frais connus des frais estimés et permettre de remplacer les hypothèses par les montants réels après la vente.

⸻

9. Assistant IA comptable

Créer un assistant conversationnel accessible depuis toutes les pages.

L’assistant doit disposer d’un accès contrôlé aux données de l’utilisateur et utiliser les mêmes règles de calcul que l’application.

9.1 Questions prises en charge

Exemples :

* « Combien ai-je gagné ce mois-ci ? »
* « Combien ai-je dépensé en achats ? »
* « Quel est mon bénéfice réel depuis janvier ? »
* « Quels sont mes cinq articles les plus rentables ? »
* « Combien d’articles dois-je encore vendre pour atteindre mon objectif ? »
* « Quel est mon stock total au prix d’achat ? »
* « Quels articles sont en stock depuis plus de 60 jours ? »
* « Quel prix dois-je fixer pour gagner 15 € sur ce sweat ? »
* « Combien puis-je réinvestir aujourd’hui ? »
* « Compare mes ventes de septembre et octobre. »
* « Prépare mon bilan mensuel. »
* « Quelles sont mes principales dépenses ? »
* « Quels articles sont vendus à perte ? »
* « Quelles données me manquent pour préparer mon bilan ? »

9.2 Comportement de l’IA

L’assistant doit :

1. Comprendre la question.
2. Identifier la période et les indicateurs concernés.
3. Interroger les données autorisées.
4. Effectuer les calculs avec le moteur financier de l’application.
5. Vérifier la cohérence des résultats.
6. Expliquer la réponse simplement.
7. Présenter les montants et les hypothèses.
8. Signaler les données manquantes.
9. Proposer une action utile lorsque cela est pertinent.

L’IA ne doit jamais inventer de chiffres.

Si elle ne dispose pas des données nécessaires, elle doit demander une précision ou indiquer ce qui manque.

Elle ne doit pas recalculer librement un bénéfice à partir de textes non vérifiés lorsque les données structurées sont disponibles.

9.3 Actions proposées par l’assistant

L’assistant peut préparer :

* Un nouvel article.
* Une correction d’opération.
* Un bilan.
* Une analyse de rentabilité.
* Une liste d’articles à revoir.
* Une proposition de budget.

Toute modification des données financières doit être présentée à l’utilisateur et confirmée avant enregistrement.

L’assistant ne doit jamais déclencher de paiement ou de déclaration officielle de manière autonome.

⸻

10. Intelligence artificielle pour les articles

Ajouter des fonctionnalités IA facultatives pour accélérer la gestion des vêtements.

10.1 Reconnaissance visuelle

Lorsqu’une photo est importée, proposer :

* Une catégorie probable.
* Une couleur dominante.
* Une description visuelle.
* Une suggestion de titre.
* Les informations que l’utilisateur devra confirmer.

Ne pas affirmer qu’une marque est authentique sur la seule base d’une photo.

10.2 Création de fiches produits

Générer une proposition de titre et de description à partir des informations fournies par l’utilisateur.

Permettre de modifier et de valider le contenu.

Les descriptions ne doivent pas inventer une taille, une marque, un état ou une caractéristique non confirmée.

10.3 Suggestions de prix

Proposer un prix à partir :

* Du prix d’achat.
* De l’état du vêtement.
* De la marque.
* De la taille.
* Du bénéfice cible.
* Des données de ventes réellement enregistrées.
* De données de marché externes uniquement si une source fiable et autorisée est disponible.

Distinguer les prix estimés des prix de vente effectivement observés.

Ne pas prétendre accéder à toutes les annonces ou aux ventes réalisées de Vinted sans source disponible.

⸻

11. Gestion du stock et des invendus

Créer un module de gestion de stock.

Afficher :

* Nombre d’articles disponibles.
* Coût d’achat du stock.
* Prix de vente prévu du stock.
* Bénéfice potentiel estimé.
* Âge moyen du stock.
* Articles immobilisés depuis longtemps.
* Articles non publiés.
* Articles en attente de préparation.

Définir des alertes configurables après 15, 30, 60 ou 90 jours.

L’utilisateur doit pouvoir marquer un article comme soldé, retiré ou perdu, avec enregistrement de l’effet financier approprié.

Le bénéfice potentiel du stock ne doit jamais être inclus dans le bénéfice réalisé.

Le stock doit être valorisé séparément du chiffre d’affaires et de la trésorerie.

⸻

12. Gestion des dépenses et justificatifs

Créer une page de dépenses avec les catégories suivantes :

* Achats de vêtements.
* Emballages.
* Matériel photo.
* Nettoyage et entretien.
* Déplacements.
* Frais de plateforme réellement supportés.
* Abonnements professionnels.
* Autres dépenses.

Chaque dépense comporte :

* Un identifiant.
* Une date.
* Un montant.
* Une catégorie.
* Un fournisseur facultatif.
* Une description.
* Un justificatif.
* Un lien avec un achat ou une vente, si applicable.
* Un statut de validation.

Permettre l’import d’images et de PDF.

Un module OCR peut extraire les informations des justificatifs. Les montants extraits doivent être confirmés en cas d’incertitude.

Une dépense directement imputée à un article ne doit pas être déduite une seconde fois dans les frais généraux.

Prévoir une détection des doublons basée sur le montant, la date, le fournisseur et les références disponibles.

⸻

13. Trésorerie et stratégie de réinvestissement

Créer un module distinct du calcul de bénéfice.

La trésorerie doit être calculée à partir des mouvements de fonds réellement enregistrés.

Prévoir :

* Solde initial.
* Encaissements confirmés.
* Décaissements confirmés.
* Montants en attente.
* Dépenses à venir.
* Remboursements à prévoir.
* Réserve de sécurité.
* Budget disponible pour les achats.

La valeur du stock ne doit jamais être ajoutée à la trésorerie.

13.1 Budget de réinvestissement

Permettre à l’utilisateur de choisir :

* Une réserve minimale.
* Un montant à conserver.
* Un objectif de réinvestissement.
* Un budget maximal par achat.

Proposer un montant disponible en tenant compte des fonds réellement disponibles, des paiements en attente, des dépenses prévues et des réserves définies.

Ne pas considérer automatiquement tout bénéfice comptable comme de l’argent encaissé.

13.2 Prévisions

Créer des scénarios à 30, 60 et 90 jours basés sur les données historiques.

Afficher clairement :

* Scénario prudent.
* Scénario central.
* Scénario optimiste.

Les projections doivent être présentées comme des estimations, avec leurs hypothèses et leurs limites.

⸻

14. Objectifs et progression

Permettre de définir :

* Un objectif de chiffre d’affaires mensuel.
* Un objectif de bénéfice commercial.
* Un nombre de ventes visé.
* Une marge moyenne minimale.
* Un budget d’achat maximal.
* Un objectif de réduction du stock.
* Un montant de trésorerie à conserver.

Afficher :

* La progression.
* Le montant restant.
* Le rythme actuel.
* Une estimation de fin de mois lorsque les données sont suffisantes.

Les objectifs doivent pouvoir être modifiés sans altérer les opérations historiques.

⸻

15. Bilans et rapports financiers

Créer une page « Bilan » avec plusieurs vues.

15.1 Bilan quotidien

* Ventes du jour.
* Achats du jour.
* Dépenses du jour.
* Bénéfice commercial estimé.
* Articles vendus.
* Opérations à vérifier.

15.2 Bilan mensuel

* Chiffre d’affaires vendeur enregistré.
* Coût des articles vendus.
* Coûts attribuables aux ventes.
* Bénéfice commercial.
* Dépenses générales.
* Résultat estimé selon la méthode de suivi.
* Achats de stock.
* Valeur du stock final.
* Trésorerie.
* Comparaison avec le mois précédent.

15.3 Bilan annuel

* Historique mensuel.
* Totaux annuels.
* Évolution de la rentabilité.
* Catégories les plus performantes.
* Principaux frais.
* Stock final.
* Liste des opérations à vérifier.

15.4 Exports

Permettre l’export :

* CSV.
* Excel XLSX.
* PDF.
* Historique des transactions.
* Inventaire du stock.
* Liste des ventes.
* Liste des achats.
* Liste des dépenses.
* Rapport mensuel.
* Dossier de justificatifs.

Chaque export doit inclure la période, la date de génération, les filtres utilisés et la définition des indicateurs.

Ne pas présenter un rapport de gestion interne comme un document comptable officiel lorsqu’il ne répond pas aux exigences correspondantes.

⸻

16. Module fiscal français

Créer un module d’aide à la préparation des obligations fiscales et sociales.

Il doit d’abord déterminer les informations nécessaires :

* Statut de l’utilisateur.
* Nature de l’activité.
* Régime fiscal.
* Régime de TVA.
* Période concernée.
* Date de début de l’activité.
* Informations utiles à la détermination des obligations applicables.

Prévoir :

* Le suivi des recettes.
* La centralisation des justificatifs.
* Les échéances pertinentes.
* Les informations à transmettre à un expert-comptable.
* Des estimations conditionnelles de cotisations et de fiscalité.
* Des alertes lorsque les informations nécessaires manquent.

Utiliser des sources officielles à jour, notamment impots.gouv.fr, service-public.fr et urssaf.fr.

Afficher la source, la date de vérification et les hypothèses des estimations.

Ne pas confondre le bénéfice commercial calculé par l’application avec le chiffre d’affaires fiscal ou le revenu imposable.

Les achats de stock, les retours, les remboursements et les frais ne sont pas nécessairement traités de la même manière selon le statut et le régime applicable.

Ne pas appliquer automatiquement un taux fiscal ou social sans vérifier sa pertinence.

Ne pas déposer de déclaration ni effectuer de paiement sans validation explicite de l’utilisateur.

⸻

17. Notifications et rappels

Créer un centre de notifications pour :

* Les articles en stock depuis longtemps.
* Les dépenses à justifier.
* Les opérations incohérentes.
* Les objectifs mensuels.
* Les données manquantes.
* Les factures ou justificatifs à traiter.
* Les écarts entre prévisions et résultats.
* Les sauvegardes ou exports demandés.

Permettre de désactiver chaque catégorie de notification.

Ne pas envoyer de notifications répétitives ou inutiles.

⸻

18. Architecture technique et développement

Choisir une architecture moderne, maintenable, sécurisée et adaptée à une première version destinée à un seul utilisateur, tout en permettant une évolution vers plusieurs comptes.

Si le développement se fait principalement pour un usage sur iPhone, privilégier une PWA responsive installable lorsque cette solution répond aux besoins. Si une application native est requise, justifier le choix technologique avant de commencer.

Une stack possible :

* Frontend : React avec TypeScript.
* Interface : Tailwind CSS ou système de composants cohérent.
* Graphiques : bibliothèque de visualisation maintenue.
* Backend et base de données : PostgreSQL avec API sécurisée, par exemple Supabase.
* Authentification : système éprouvé avec gestion de sessions.
* Stockage : service privé pour les photos et justificatifs.
* IA : modèle accessible via un backend sécurisé.
* Tests : tests unitaires, tests d’intégration et tests de parcours utilisateur.

Cette stack est une proposition, pas une obligation si l’environnement de développement impose une autre technologie adaptée.

Ne pas exposer les clés secrètes dans le frontend.

Ne pas accorder à l’IA un accès direct non contrôlé à la base de données.

Mettre en place des permissions serveur et des règles d’isolation des données.

18.1 Modèle de données

Créer au minimum les entités suivantes :

* Users.
* UserSettings.
* Items.
* Purchases.
* PurchaseLines.
* Sales.
* SaleLines.
* Expenses.
* Transactions.
* InventoryMovements.
* Refunds.
* Attachments.
* Goals.
* Notifications.
* AuditLogs.
* AIConversations.

Chaque enregistrement doit être associé au bon utilisateur.

Utiliser des identifiants uniques, des relations cohérentes, des contraintes d’intégrité et des dates fiables.

Utiliser un type décimal adapté pour les montants monétaires. Éviter les erreurs de précision dues aux nombres flottants binaires.

Conserver les montants en euros avec une règle d’arrondi documentée.

18.2 Traçabilité financière

Toutes les opérations validées doivent pouvoir être retracées.

Prévoir :

* Une date de création.
* Une date de modification.
* Un identifiant d’opération.
* Une origine de données.
* Un statut de validation.
* Un historique des corrections.

Les corrections financières importantes doivent produire un historique ou un ajustement plutôt qu’une suppression silencieuse.

18.3 Import et export

Permettre l’import de fichiers CSV avec :

* Détection des colonnes.
* Prévisualisation des données.
* Association des colonnes.
* Validation des montants et des dates.
* Détection des doublons.
* Rapport des lignes rejetées.
* Confirmation avant import définitif.

Ne pas supposer que Vinted fournit une API publique permettant d’accéder à toutes les commandes ou à toutes les ventes.

Si une connexion officielle est disponible et autorisée, l’intégrer selon ses conditions. Sinon, utiliser l’import de fichiers et la saisie manuelle.

Ne jamais demander le mot de passe Vinted, contourner les protections de la plateforme ou scraper des données sans autorisation appropriée.

⸻

19. Sécurité et protection des données

Mettre en œuvre :

* Authentification sécurisée.
* Contrôle d’accès.
* Chiffrement des communications.
* Stockage privé des justificatifs.
* Validation des données côté serveur.
* Protection contre les accès croisés entre utilisateurs.
* Sauvegardes.
* Journalisation des opérations sensibles.
* Export des données personnelles.
* Suppression du compte selon une procédure claire.
* Gestion des erreurs sans divulgation de données confidentielles.

Respecter les exigences applicables du RGPD.

Les conversations IA ne doivent recevoir que les informations strictement nécessaires à la demande.

Aucune action financière irréversible ne doit être effectuée sans autorisation appropriée.

⸻

20. Tests obligatoires

Avant la livraison, créer des tests automatisés pour les cas suivants.

Cas A : vente rentable

Achat : 5 €.
Frais directs : 1 €.
Revenu vendeur : 18 €.
Autres frais supportés : 0 €.

Résultat attendu :

* Coût de revient : 6 €.
* Bénéfice commercial : 12 €.
* Marge commerciale : 66,67 %.
* ROI : 200 %.

Cas B : vente à perte

Achat : 20 €.
Frais directs : 2 €.
Revenu vendeur : 15 €.
Autres frais : 1 €.

Résultat attendu :

* Coût de revient : 22 €.
* Bénéfice commercial : -8 €.
* Alerte de vente à perte.

Cas C : stock invendu

Achat : 10 €.
Aucune vente enregistrée.

Résultat attendu :

* Valeur du stock au coût d’achat : 10 €.
* Chiffre d’affaires : 0 €.
* Bénéfice réalisé sur cet article : 0 € avant prise en compte d’éventuelles dépréciations ou autres charges.
* Bénéfice potentiel non inclus dans le bénéfice réalisé.

Cas D : double comptabilisation

Enregistrer un achat puis une vente.

Résultat attendu :

* L’achat est associé au coût de revient.
* La vente génère le revenu vendeur.
* Le coût de revient est imputé une seule fois au résultat commercial.
* L’achat de stock n’est pas ajouté une seconde fois aux dépenses du compte de résultat si ce coût est déjà imputé via l’article vendu.

Cas E : remboursement

Enregistrer une vente, puis un remboursement partiel ou total.

Résultat attendu :

* La vente initiale reste consultable.
* Le remboursement est enregistré.
* Les montants sont ajustés sans doublon.
* Le stock n’est restauré que lorsque l’article est effectivement récupéré.

Cas F : trésorerie et stock

Acheter un article pour 15 €, puis le vendre pour un revenu vendeur de 30 €, avec 2 € de frais supplémentaires supportés.

Résultat attendu, hors autres mouvements :

* Bénéfice commercial : 13 €.
* Les mouvements de trésorerie reflètent les encaissements et décaissements réellement enregistrés.
* Le stock est mis à jour.
* Le bénéfice ne doit pas être assimilé automatiquement à la trésorerie disponible.

Ajouter des tests pour les arrondis, les montants nuls, les remboursements, les ventes groupées, les imports en double et les changements de période.

⸻

21. Étapes de développement

Ne pas tenter de construire toutes les fonctionnalités simultanément sans vérifier le fonctionnement des fondations.

Phase 1 — MVP fonctionnel

Développer :

* L’interface sombre inspirée de FlipAI.
* L’authentification.
* Le tableau de bord.
* Les articles et les photos.
* Les achats.
* Les ventes.
* Le calcul des bénéfices.
* Le stock.
* Les dépenses.
* La persistance des données.

Livrable : une application utilisable avec de vraies données.

Phase 2 — Comptabilité et analyses

Ajouter :

* Les bilans mensuels.
* Les graphiques.
* Les exports.
* Le suivi de trésorerie.
* Les objectifs.
* Les alertes d’invendus.
* Les corrections et l’historique des opérations.

Phase 3 — Intelligence artificielle

Ajouter :

* L’assistant conversationnel.
* L’analyse de rentabilité.
* Les suggestions de prix.
* La génération de titres et descriptions.
* L’analyse des performances.
* La préparation des rapports.

Phase 4 — Améliorations avancées

Ajouter :

* L’import de fichiers.
* L’OCR des justificatifs.
* Les prévisions financières.
* Le module fiscal.
* Les notifications.
* Les éventuelles intégrations externes autorisées.

Phase 5 — Validation et livraison

Effectuer :

* Les tests fonctionnels.
* Les tests de calcul.
* Les tests de sécurité.
* Les tests sur iPhone.
* Les tests de persistance.
* Les tests d’export.
* La correction des bugs.
* La rédaction de la documentation.

⸻

22. Critères d’acceptation finale

L’application ne sera considérée comme livrée que si :

* Un utilisateur peut créer son compte.
* Les données restent disponibles après fermeture et réouverture.
* Un achat peut être enregistré.
* Un article peut être publié dans le suivi interne.
* Une vente peut être enregistrée.
* Le bénéfice est recalculé correctement.
* Le stock est mis à jour.
* Une dépense peut être associée à une opération.
* Le tableau de bord utilise les données réellement stockées.
* Les filtres fonctionnent.
* Les rapports correspondent aux opérations enregistrées.
* Les exports sont lisibles et exacts.
* L’assistant IA utilise les chiffres de la base de données.
* Les erreurs de calcul et les doublons sont traités.
* L’interface fonctionne sur iPhone.
* Aucune connexion Vinted fictive n’est présentée comme opérationnelle.
* Les données personnelles restent protégées.

Instruction finale au développeur

Commence par analyser l’environnement de développement disponible et choisir l’architecture adaptée.

Construis ensuite une première version réellement fonctionnelle, avec une base de données persistante, le design sombre premium et les fonctions fondamentales de comptabilité.

Ne t’arrête pas à la génération de fichiers ou à l’affichage d’une interface.

Lance les tests, corrige les erreurs et vérifie les parcours utilisateurs.

Si une intégration ou une fonctionnalité dépend d’un service externe indisponible, indique-le clairement et propose une solution de remplacement opérationnelle.

À la fin, fournis :

* Le code source.
* Les instructions d’installation.
* Les variables d’environnement nécessaires, sans secrets intégrés.
* Les migrations de base de données.
* Les tests.
* Les instructions de déploiement.
* La procédure de sauvegarde.
* La liste des fonctionnalités réellement opérationnelles.
* La liste des fonctionnalités qui nécessitent encore une intégration externe.

Priorité absolue : exactitude des calculs financiers, fiabilité des données, simplicité d’utilisation sur iPhone et qualité visuelle premium.