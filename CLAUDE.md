# CNG Vinted

- À chaque mise à jour publiée qui change quelque chose pour les utilisateurs, ajouter une entrée en haut de `src/lib/changelog.ts` (fenêtre « Nouveautés » montrée à l’ouverture). Points réservés à la bêta : `beta: true`.
- Déploiement : `git push cngapp main:source` (site cngapp.github.io) et `git push origin main` (ancienne adresse).
- Jamais de code admin, de clé ou de jeton en clair dans le dépôt (public) : seulement des empreintes.
- Pages publiques (présentation, calculateur, guides, robots.txt, sitemap.xml, llms.txt) : générées par `node scripts/site.mjs` dans public/ ; mettre à jour `UPDATED` et le sitemap à chaque nouvelle page. Les faits sur Vinted cités doivent venir des pages Vinted (frais, envoi) et être revérifiés.
