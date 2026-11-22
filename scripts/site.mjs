/**
 * Pages publiques lisibles par Google (sans JavaScript) : présentation, calculateur, guides,
 * robots.txt, sitemap.xml et llms.txt. Elles sont générées dans public/ puis copiées telles quelles
 * à la racine du site par Vite.
 *
 * Lancer après une modification : node scripts/site.mjs
 * Les faits sur Vinted cités dans les guides viennent des pages d'aide et de la grille tarifaire
 * de Vinted : les revérifier à chaque mise à jour (les montants changent).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SITE = 'https://cngapp.github.io';
const UPDATED = '2026-11-22';
const OUT = new URL('../public/', import.meta.url).pathname;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LOGO = `<svg viewBox="40 110 430 290" height="30" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M176.3 179.5 A65.0 65.0 0 1 0 176.3 266.5" stroke="currentColor" stroke-width="36"/><path d="M212 288 V158 L296 288 V158" stroke="currentColor" stroke-width="36"/><path d="M430.3 179.5 A65.0 65.0 0 1 0 447.0 223.0 H386" stroke="currentColor" stroke-width="36"/><path d="M63 372 H290 L330 350 L356 364 L432 314" stroke="#63F77B" stroke-width="22"/><path d="M398 314 H432 V348" stroke="#63F77B" stroke-width="22"/></g></svg>`;

const ORG = { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'CNG Vinted', url: `${SITE}/`, logo: `${SITE}/icon-512.png`, sameAs: ['https://www.instagram.com/cngvinted/'] };

function page({ path, title, description, h1, lead, body, schema = [], ogType = 'website', script = '' }) {
  const url = `${SITE}${path}`;
  const ld = { '@context': 'https://schema.org', '@graph': [ORG, ...schema] };
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#090B0A">
<meta property="og:type" content="${ogType}">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="CNG Vinted">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="stylesheet" href="/site.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<header class="top"><a class="brand" href="/decouvrir/">${LOGO}<span>CNG Vinted</span></a>
<nav><a href="/calculateur-benefice-vinted/">Calculateur</a><a href="/guides/">Guides</a><a class="cta-sm" href="/">Ouvrir l’appli</a></nav></header>
<main>
<h1>${h1}</h1>
${lead ? `<p class="lead">${lead}</p>` : ''}
${body}
</main>
<footer><div class="wrap">
<p><a href="/decouvrir/">Présentation</a> · <a href="/calculateur-benefice-vinted/">Calculateur de bénéfice</a> · <a href="/guides/">Guides</a> · <a href="/confidentialite.html">Confidentialité</a> · <a href="/conditions.html">Conditions d’utilisation</a> · <a href="https://www.instagram.com/cngvinted/" rel="me">Instagram</a></p>
<p class="mut">CNG Vinted est un outil indépendant, sans lien avec Vinted. Mis à jour le ${new Date(UPDATED).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
</div></footer>
${script}
</body>
</html>
`;
}

const shot = (src, alt, eager = false) => `<figure class="shot"><img src="/img/${src}.webp" alt="${esc(alt)}" width="280" height="606" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></figure>`;
const install = `<section class="card" id="installer"><h2>Installer l’appli en 30 secondes</h2>
<ol><li><b>iPhone</b> : ouvre <a href="/">cngapp.github.io</a> dans Safari, touche <b>Partager</b>, puis <b>Sur l’écran d’accueil</b>.</li>
<li><b>Android</b> : ouvre <a href="/">cngapp.github.io</a> dans Chrome, touche le menu <b>⋮</b>, puis <b>Installer l’application</b>.</li></ol>
<p>Pas d’App Store, pas de compte à créer, rien à payer.</p>
<p><a class="cta" href="/">Ouvrir CNG Vinted</a></p></section>`;
const faqItems = [
  ['CNG Vinted est-il gratuit ?', 'Oui. L’appli est gratuite, sans abonnement et sans publicité.'],
  ['Faut-il passer par l’App Store ou le Play Store ?', 'Non. C’est une appli web : tu l’ouvres dans ton navigateur puis tu l’ajoutes à l’écran d’accueil. Elle fonctionne ensuite comme une appli, même sans réseau.'],
  ['Où sont stockées mes données ?', 'Sur ton téléphone. Elles ne sont envoyées sur aucun serveur. Tu peux en faire une sauvegarde (fichier ou ton Google Drive).'],
  ['L’appli me demande-t-elle mon mot de passe Vinted ?', 'Jamais. La synchronisation lit les e-mails que Vinted t’envoie, avec un accès Gmail en lecture seule que tu peux retirer à tout moment.'],
  ['Est-ce que ça marche sans Gmail ?', 'Oui. Tu peux saisir tes ventes et tes achats à la main ; la synchronisation Gmail évite seulement de les taper.'],
  ['CNG Vinted est-il lié à Vinted ?', 'Non. C’est un outil indépendant, créé par un vendeur pour les vendeurs.'],
];
const faq = `<section><h2>Questions fréquentes</h2>${faqItems.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</section>`;
const faqSchema = { '@type': 'FAQPage', mainEntity: faqItems.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
const appSchema = {
  '@type': 'SoftwareApplication', name: 'CNG Vinted', url: `${SITE}/`, applicationCategory: 'FinanceApplication', operatingSystem: 'iOS, Android, Web', inLanguage: 'fr',
  description: 'Application gratuite pour suivre ses ventes Vinted et calculer son vrai bénéfice : stock, dépenses, bordereaux, bilan et exports.',
  image: `${SITE}/icon-512.png`, screenshot: `${SITE}/img/ventes.webp`, offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, publisher: { '@id': `${SITE}/#org` },
};
const crumbs = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}${path}` })) });
const article = (path, headline, description) => ({ '@type': 'Article', headline, description, inLanguage: 'fr', dateModified: UPDATED, datePublished: UPDATED, mainEntityOfPage: `${SITE}${path}`, image: `${SITE}/og-image.jpg`, author: { '@id': `${SITE}/#org` }, publisher: { '@id': `${SITE}/#org` } });
const appBox = `<aside class="card app"><p><b>Fais-le automatiquement avec CNG Vinted.</b> L’appli enregistre tes ventes depuis tes e-mails Vinted et calcule le bénéfice de chaque article. Gratuit, iPhone et Android.</p><p><a class="cta" href="/decouvrir/">Découvrir l’appli</a></p></aside>`;
const SRC_PRICES = '<a href="https://www.vinted.fr/pricelist" rel="nofollow">grille tarifaire de Vinted</a>';

const pages = {
  'decouvrir/index.html': page({
    path: '/decouvrir/',
    title: 'CNG Vinted : suivre ses ventes et son bénéfice Vinted',
    description: 'L’appli gratuite des vendeurs Vinted : bénéfice réel par article, ventes enregistrées depuis Gmail, stock, bordereaux et bilan. Sans abonnement.',
    h1: 'Ta compta Vinted, <span class="g">sans tableur</span>',
    lead: 'CNG Vinted calcule ce que tu gagnes vraiment sur chaque vente : prix d’achat, emballage et options payantes déduits. Gratuit, sans abonnement, sur iPhone et Android.',
    schema: [appSchema, faqSchema],
    body: `<p><a class="cta" href="/">Ouvrir l’appli</a> <a class="cta ghost" href="#installer">Comment l’installer</a></p>
<section class="grid2"><div><h2>Le vrai bénéfice de chaque vente</h2><p>Ton solde Vinted n’est pas ton bénéfice. Pour chaque article, l’appli retire ce que tu l’as payé et ce que la vente t’a coûté, et affiche le résultat : marge, rentabilité, bénéfice du mois.</p></div>${shot('vente', 'Détail d’une vente dans CNG Vinted : bénéfice de 20,50 € sur un sweat vendu 32 €', true)}</section>
<section class="grid2 rev"><div><h2>Tes ventes arrivent toutes seules</h2><p>Connecte ton Gmail en lecture seule : chaque vente, envoi et paiement reçu par e-mail de Vinted s’enregistre dans l’appli. Plusieurs comptes Vinted ? Chaque adresse Gmail va dans son propre dressing.</p><p class="mut">Jamais ton mot de passe Vinted. Tes données restent sur ton téléphone.</p></div>${shot('ventes', 'Liste des ventes Vinted avec le bénéfice de chaque article')}</section>
<section class="grid2"><div><h2>Le bilan du mois en un coup d’œil</h2><p>Chiffre d’affaires, coût des articles vendus, dépenses, bénéfice : le bilan se met à jour à chaque vente. Exporte-le en Excel ou en PDF.</p></div>${shot('bilan', 'Bilan mensuel des ventes Vinted dans CNG Vinted')}</section>
<section><h2>Tout ce que fait l’appli</h2><ul class="feats">
<li><b>Bordereaux</b> : tous tes bordereaux d’envoi Vinted reçus par e-mail, imprimés d’un coup (étiquette 10 × 15 ou feuille A4).</li>
<li><b>Stock et lots</b> : coût de chaque article, lots répartis automatiquement, articles qui dorment.</li>
<li><b>Prix d’achat habituels</b> : un prix par catégorie ou par modèle, rempli tout seul à chaque achat.</li>
<li><b>Dépenses</b> : emballages, Boost, déplacements, rangés par catégorie.</li>
<li><b>Statistiques</b> : tes meilleures marques, tes meilleurs jours, ton délai de vente.</li>
<li><b>Exports</b> : Excel, PDF et CSV, pour toi ou ton comptable.</li>
<li><b>Calculateur de prix</b> : simule ton bénéfice avant de publier.</li>
<li><b>Plusieurs dressings</b> : un suivi séparé par compte Vinted, avec le total cumulé.</li></ul></section>
${install}
${faq}
<section><h2>Qui fait CNG Vinted ?</h2><p>CNG Vinted est développé par Clevin, revendeur sur Vinted, qui voulait connaître son vrai bénéfice sans tenir un tableur. L’appli est indépendante de Vinted. Une question ou une idée : <a href="https://www.instagram.com/cngvinted/">@cngvinted sur Instagram</a>.</p></section>`,
  }),

  'calculateur-benefice-vinted/index.html': page({
    path: '/calculateur-benefice-vinted/',
    title: 'Calculateur de bénéfice Vinted gratuit',
    description: 'Calcule le bénéfice et la marge d’une vente Vinted : prix de vente, prix d’achat, emballage et Boost. Gratuit, sans inscription, résultat immédiat.',
    h1: 'Calculateur de bénéfice Vinted',
    lead: 'Entre le prix de vente et ce que l’article t’a coûté : le bénéfice et la marge s’affichent tout de suite.',
    schema: [{ '@type': 'WebApplication', name: 'Calculateur de bénéfice Vinted', url: `${SITE}/calculateur-benefice-vinted/`, applicationCategory: 'FinanceApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, publisher: { '@id': `${SITE}/#org` } }, crumbs([['CNG Vinted', '/decouvrir/'], ['Calculateur de bénéfice', '/calculateur-benefice-vinted/']])],
    body: `<form class="card calc" id="calc" onsubmit="return false">
<label>Prix de vente sur Vinted (€)<input inputmode="decimal" id="vente" placeholder="25" autocomplete="off"></label>
<label>Prix d’achat de l’article (€)<input inputmode="decimal" id="achat" placeholder="8" autocomplete="off"></label>
<label>Emballage (€)<input inputmode="decimal" id="emb" placeholder="0,50" autocomplete="off"></label>
<label>Boost, vitrine et autres frais (€)<input inputmode="decimal" id="autres" placeholder="0" autocomplete="off"></label>
<output id="res" aria-live="polite"><span class="mut">Entre au moins le prix de vente.</span></output></form>
<section><h2>Comment le calcul est fait</h2>
<p><b>Bénéfice = prix de vente − prix d’achat − emballage − autres frais.</b> La marge est le bénéfice divisé par le prix de vente.</p>
<p>En France, un vendeur particulier ne paie pas de commission sur ses ventes Vinted : les frais de protection et de livraison sont payés par l’acheteur, et le bordereau d’envoi est prépayé. Les options de visibilité (Boost, dressing en vitrine) sont payantes pour le vendeur, mais facultatives. Les montants peuvent changer : vérifie la ${SRC_PRICES}.</p></section>
${appBox}`,
    script: `<script>
(function(){var f=function(id){var v=(document.getElementById(id).value||'').replace(/\\s/g,'').replace(',','.');var n=parseFloat(v);return isFinite(n)?n:0};
var eur=function(n){return n.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})};
function run(){var v=f('vente'),a=f('achat'),e=f('emb'),o=f('autres'),out=document.getElementById('res');
if(!v){out.innerHTML='<span class="mut">Entre au moins le prix de vente.</span>';return}
var b=v-a-e-o,m=b/v*100,roi=a>0?b/a*100:null;
out.innerHTML='<span class="big '+(b>=0?'g':'r')+'">'+(b>=0?'+':'')+eur(b)+'</span><span>Marge : '+m.toFixed(0)+' %'+(roi===null?'':' · Rentabilité de l’achat : '+roi.toFixed(0)+' %')+'</span>'}
document.getElementById('calc').addEventListener('input',run);run()})();
</script>`,
  }),

  'guides/index.html': page({
    path: '/guides/',
    title: 'Guides pour vendeurs Vinted · CNG Vinted',
    description: 'Guides pratiques pour vendeurs Vinted : vrai bénéfice, prix de revente, achat en lot, bordereaux imprimés d’un coup, suivi des ventes sans tableur.',
    h1: 'Guides pour vendeurs Vinted',
    lead: 'Des réponses courtes aux questions que se posent les revendeurs.',
    schema: [crumbs([['CNG Vinted', '/decouvrir/'], ['Guides', '/guides/']])],
    body: `<ul class="guides">
<li><a href="/guides/calculer-benefice-vinted/"><b>Calculer son vrai bénéfice sur Vinted</b><span>Ce qu’il faut retirer du prix de vente, avec un exemple chiffré.</span></a></li>
<li><a href="/guides/imprimer-bordereaux-vinted/"><b>Imprimer tous ses bordereaux Vinted d’un coup</b><span>Fini d’ouvrir chaque e-mail un par un.</span></a></li>
<li><a href="/guides/suivre-ventes-vinted-sans-tableur/"><b>Suivre ses ventes Vinted sans tableur</b><span>Ce qu’il faut noter, et comment l’automatiser.</span></a></li>
<li><a href="/guides/prix-revente-vinted/"><b>Fixer le bon prix de revente sur Vinted</b><span>Coût, marge visée, comparaison et négociation.</span></a></li>
<li><a href="/guides/rentabiliser-lot-vinted/"><b>Acheter un lot : le coût de chaque article</b><span>Répartir le prix d’un lot pour connaître le bénéfice de chaque article.</span></a></li>
<li><a href="/calculateur-benefice-vinted/"><b>Calculateur de bénéfice Vinted</b><span>Le résultat d’une vente en 10 secondes.</span></a></li></ul>`,
  }),

  'guides/calculer-benefice-vinted/index.html': page({
    path: '/guides/calculer-benefice-vinted/',
    ogType: 'article',
    title: 'Comment calculer son vrai bénéfice sur Vinted',
    description: 'Ton solde Vinted n’est pas ton bénéfice. Ce qu’il faut retirer du prix de vente (achat, emballage, Boost), avec un exemple chiffré et un calculateur gratuit.',
    h1: 'Comment calculer son vrai bénéfice sur Vinted',
    lead: 'Ton bénéfice, c’est le prix de vente moins tout ce que l’article t’a coûté : son prix d’achat, l’emballage et les options payantes. Le reste du guide détaille chaque ligne.',
    schema: [article('/guides/calculer-benefice-vinted/', 'Comment calculer son vrai bénéfice sur Vinted', 'Ce qu’il faut retirer du prix de vente pour connaître son vrai bénéfice sur Vinted.'), crumbs([['CNG Vinted', '/decouvrir/'], ['Guides', '/guides/'], ['Calculer son bénéfice', '/guides/calculer-benefice-vinted/']])],
    body: `<h2>La formule</h2>
<p class="card formula"><b>Bénéfice = prix de vente − prix d’achat − emballage − options payantes − autres frais liés</b></p>
<h2>Ce que tu n’as pas à retirer</h2>
<p>En France, un vendeur particulier ne paie pas de commission sur ses ventes. Les frais de protection acheteurs et la livraison sont payés par l’acheteur, et le bordereau d’envoi est prépayé. Le montant que tu reçois correspond donc au prix de l’article. Les règles peuvent évoluer : vérifie la ${SRC_PRICES}.</p>
<h2>Ce que tu dois retirer</h2>
<ul><li><b>Le prix d’achat</b> : ce que tu as payé l’article (friperie, vide-grenier, achat sur Vinted). Pour un lot, répartis le prix entre les articles.</li>
<li><b>L’emballage</b> : sachets, cartons, scotch. Quelques dizaines de centimes par colis, qui comptent sur un mois.</li>
<li><b>Les options payantes</b> : Boost et dressing en vitrine sont facultatifs mais payés par le vendeur.</li>
<li><b>Les frais liés</b> : déplacement pour acheter, nettoyage, retouches.</li></ul>
<h2>Exemple</h2>
<table><thead><tr><th>Ligne</th><th>Montant</th></tr></thead><tbody>
<tr><td>Sweat vendu</td><td>32,00 €</td></tr><tr><td>Prix d’achat en friperie</td><td>− 11,00 €</td></tr><tr><td>Emballage</td><td>− 0,50 €</td></tr><tr><td><b>Bénéfice</b></td><td><b>20,50 €</b></td></tr></tbody></table>
<p>Marge : 64 % du prix de vente. Rentabilité de l’achat : 186 % (20,50 € gagnés pour 11 € dépensés).</p>
<h2>Les erreurs fréquentes</h2>
<ul><li>Regarder le solde du porte-monnaie Vinted : il mélange les ventes de plusieurs mois et n’enlève pas tes achats.</li>
<li>Oublier les articles achetés mais pas encore vendus : ils ont coûté de l’argent, c’est ton stock.</li>
<li>Compter les ventes avant qu’elles soient terminées : une vente peut encore être annulée ou remboursée.</li></ul>
<p><a class="cta" href="/calculateur-benefice-vinted/">Calculer le bénéfice d’une vente</a></p>
${appBox}`,
  }),

  'guides/imprimer-bordereaux-vinted/index.html': page({
    path: '/guides/imprimer-bordereaux-vinted/',
    ogType: 'article',
    title: 'Imprimer tous ses bordereaux Vinted d’un coup',
    description: 'Plusieurs ventes Vinted à envoyer ? Comment récupérer tous les bordereaux reçus par e-mail et les imprimer en une fois, en étiquette 10 × 15 ou sur feuille A4.',
    h1: 'Imprimer tous ses bordereaux Vinted d’un coup',
    lead: 'Vinted envoie un bordereau d’envoi par e-mail pour chaque vente. Quand tu en as plusieurs, le plus rapide est de les rassembler dans un seul PDF et de tout imprimer en une fois.',
    schema: [article('/guides/imprimer-bordereaux-vinted/', 'Imprimer tous ses bordereaux Vinted d’un coup', 'Rassembler et imprimer en une fois les bordereaux d’envoi Vinted reçus par e-mail.'), crumbs([['CNG Vinted', '/decouvrir/'], ['Guides', '/guides/'], ['Imprimer ses bordereaux', '/guides/imprimer-bordereaux-vinted/']])],
    body: `<h2>À la main</h2>
<ol><li>Ouvre chaque e-mail « bordereau d’envoi » de Vinted.</li>
<li>Télécharge le bordereau (PDF) de chaque vente.</li>
<li>Imprime-les un par un, en vérifiant le format demandé par le transporteur.</li></ol>
<p>Ça marche, mais avec 10 ventes, ça fait 10 e-mails à ouvrir et 10 impressions. Pour l’envoi lui-même, suis les instructions de la <a href="https://www.vinted.fr/help/482" rel="nofollow">page d’aide Vinted « Envoyer un article »</a>.</p>
<h2>Avec CNG Vinted</h2>
<ol><li>Connecte ton Gmail en lecture seule dans l’appli (Synchro Vinted).</li>
<li>Ouvre <b>Bordereaux</b> : tous les bordereaux reçus par e-mail sont listés, ceux déjà imprimés sont marqués.</li>
<li>Choisis le format : <b>étiquette 10 × 15</b> ou <b>feuille A4</b>, puis imprime tout d’un coup.</li></ol>
<p class="mut">L’appli lit seulement les e-mails de Vinted et ne demande jamais ton mot de passe Vinted.</p>
${appBox}`,
  }),

  'guides/suivre-ventes-vinted-sans-tableur/index.html': page({
    path: '/guides/suivre-ventes-vinted-sans-tableur/',
    ogType: 'article',
    title: 'Suivre ses ventes Vinted sans tableur',
    description: 'Ce qu’il faut noter pour suivre ses ventes Vinted (achat, vente, frais, stock) et comment l’automatiser à partir de tes e-mails Vinted, gratuitement.',
    h1: 'Suivre ses ventes Vinted sans tableur',
    lead: 'Pour savoir si ta revente est rentable, il faut suivre quatre choses : tes achats, tes ventes, tes frais et ton stock. Un tableur marche, mais il faut tout taper.',
    schema: [article('/guides/suivre-ventes-vinted-sans-tableur/', 'Suivre ses ventes Vinted sans tableur', 'Ce qu’il faut noter pour suivre ses ventes Vinted et comment l’automatiser.'), crumbs([['CNG Vinted', '/decouvrir/'], ['Guides', '/guides/'], ['Suivre ses ventes', '/guides/suivre-ventes-vinted-sans-tableur/']])],
    body: `<h2>Ce qu’il faut noter</h2>
<table><thead><tr><th>Quoi</th><th>Pourquoi</th></tr></thead><tbody>
<tr><td>Chaque achat (prix, date, source)</td><td>C’est le coût de l’article, à retirer de la vente.</td></tr>
<tr><td>Chaque vente (prix, date, état)</td><td>Le chiffre d’affaires, et ce qui reste à expédier.</td></tr>
<tr><td>Les frais (emballage, Boost, déplacements)</td><td>Ils réduisent le bénéfice réel.</td></tr>
<tr><td>Le stock (articles pas encore vendus)</td><td>De l’argent immobilisé ; un article qui dort trop longtemps est à baisser.</td></tr></tbody></table>
<h2>Pourquoi le tableur finit abandonné</h2>
<p>Il faut recopier chaque vente, retrouver le prix d’achat, et tenir à jour les statuts (vendu, expédié, terminé). Au bout de quelques semaines, il n’est plus à jour.</p>
<h2>L’automatiser</h2>
<p>Vinted t’envoie un e-mail à chaque vente, envoi et paiement. CNG Vinted lit ces e-mails (Gmail, lecture seule) et enregistre les ventes toutes seules. Tu n’ajoutes que le prix d’achat, et encore : un prix par catégorie peut se remplir automatiquement.</p>
<p>Tu obtiens le bénéfice de chaque vente, le bilan du mois, ton stock et des exports Excel ou PDF.</p>
${appBox}`,
  }),

  'guides/prix-revente-vinted/index.html': page({
    path: '/guides/prix-revente-vinted/',
    ogType: 'article',
    title: 'Fixer le bon prix de revente sur Vinted',
    description: 'Comment fixer le prix d’un article sur Vinted : partir de ce qu’il t’a coûté, viser une marge, comparer aux annonces similaires et laisser une place à la négociation.',
    h1: 'Fixer le bon prix de revente sur Vinted',
    lead: 'Un bon prix couvre ce que l’article t’a coûté, te laisse la marge que tu vises et reste dans la fourchette des annonces similaires. Voici une méthode en 4 étapes.',
    schema: [article('/guides/prix-revente-vinted/', 'Fixer le bon prix de revente sur Vinted', 'Méthode en 4 étapes pour fixer le prix d’un article sur Vinted.'), crumbs([['CNG Vinted', '/decouvrir/'], ['Guides', '/guides/'], ['Prix de revente', '/guides/prix-revente-vinted/']])],
    body: `<ol class="steps">
<li><b>Calcule ton coût</b> : prix d’achat de l’article, plus l’emballage et les frais liés (nettoyage, retouches).</li>
<li><b>Ajoute la marge que tu vises</b> : par exemple 10 € par article, ou un pourcentage du prix de vente. Prix minimum = coût + marge visée.</li>
<li><b>Compare</b> : cherche le même article (marque, taille, état) sur Vinted et regarde les prix des annonces. Si ton prix minimum est au-dessus, l’article risque de dormir.</li>
<li><b>Garde une marge de négociation</b> : beaucoup d’acheteurs font une offre. Affiche un peu au-dessus de ton prix minimum pour pouvoir accepter une offre sans perdre d’argent.</li></ol>
<h2>Exemple</h2>
<table><thead><tr><th>Ligne</th><th>Montant</th></tr></thead><tbody>
<tr><td>Achat en friperie</td><td>8,00 €</td></tr><tr><td>Emballage</td><td>0,50 €</td></tr><tr><td>Marge visée</td><td>10,00 €</td></tr>
<tr><td><b>Prix minimum accepté</b></td><td><b>18,50 €</b></td></tr><tr><td>Prix affiché (marge de négociation)</td><td>22,00 €</td></tr></tbody></table>
<h2>Les erreurs fréquentes</h2>
<ul><li>Fixer le prix d’après ce que tu as payé neuf : l’acheteur compare avec les annonces d’occasion.</li>
<li>Oublier l’emballage et les options payantes (Boost) dans le coût.</li>
<li>Ne jamais baisser un article qui ne se vend pas : de l’argent reste bloqué dans ton stock.</li></ul>
<p><a class="cta" href="/calculateur-benefice-vinted/">Tester un prix avec le calculateur</a></p>
${appBox}`,
  }),

  'guides/rentabiliser-lot-vinted/index.html': page({
    path: '/guides/rentabiliser-lot-vinted/',
    ogType: 'article',
    title: 'Lot pour la revente Vinted : le coût de chaque article',
    description: 'Tu achètes un lot de vêtements pour le revendre sur Vinted ? Comment répartir le prix du lot entre les articles pour connaître le vrai bénéfice de chacun.',
    h1: 'Acheter un lot : le coût de chaque article',
    lead: 'Quand tu achètes un lot, chaque article doit porter une part du prix. Sans ça, impossible de savoir lesquels sont rentables. Il existe deux façons simples de répartir.',
    schema: [article('/guides/rentabiliser-lot-vinted/', 'Acheter un lot pour la revente : calculer le coût de chaque article', 'Répartir le prix d’un lot entre ses articles pour connaître le bénéfice de chacun.'), crumbs([['CNG Vinted', '/decouvrir/'], ['Guides', '/guides/'], ['Rentabiliser un lot', '/guides/rentabiliser-lot-vinted/']])],
    body: `<h2>1. Parts égales</h2>
<p>Le prix du lot est divisé par le nombre d’articles. Simple, mais injuste quand les articles n’ont pas la même valeur : une veste et un t-shirt portent le même coût.</p>
<h2>2. Selon le prix de revente visé</h2>
<p>Chaque article porte une part proportionnelle au prix auquel tu comptes le revendre. Un article qui se revend plus cher porte une plus grande part du lot.</p>
<h2>Exemple : lot de 3 articles acheté 30 €</h2>
<table><thead><tr><th>Article</th><th>Prix visé</th><th>Parts égales</th><th>Selon le prix visé</th></tr></thead><tbody>
<tr><td>Veste</td><td>40 €</td><td>10,00 €</td><td>20,00 €</td></tr>
<tr><td>Sweat</td><td>14 €</td><td>10,00 €</td><td>7,00 €</td></tr>
<tr><td>T-shirt</td><td>6 €</td><td>10,00 €</td><td>3,00 €</td></tr></tbody></table>
<p>Avec des parts égales, le t-shirt semble vendu à perte (6 € pour 10 € de coût) alors que le lot entier est rentable. La répartition selon le prix visé donne une image plus juste.</p>
<h2>Dans CNG Vinted</h2>
<p>Quand tu enregistres un achat en lot, tu choisis la répartition : selon le prix souhaité, parts égales, ou montant saisi à la main. Le coût de chaque article est ensuite utilisé pour calculer le bénéfice de sa vente.</p>
${appBox}`,
  }),
};

const ROBOTS = `User-agent: *
Allow: /
Disallow: /beta/

Sitemap: ${SITE}/sitemap.xml
`;
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/decouvrir/', '/calculateur-benefice-vinted/', '/guides/', '/guides/calculer-benefice-vinted/', '/guides/imprimer-bordereaux-vinted/', '/guides/suivre-ventes-vinted-sans-tableur/', '/guides/prix-revente-vinted/', '/guides/rentabiliser-lot-vinted/', '/confidentialite.html', '/conditions.html']
  .map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${UPDATED}</lastmod></url>`).join('\n')}
</urlset>
`;
const LLMS = `# CNG Vinted

> Application web gratuite (iPhone, Android, navigateur) pour les vendeurs Vinted : elle calcule le vrai bénéfice de chaque vente (prix de vente moins prix d'achat, emballage et options payantes), enregistre les ventes à partir des e-mails Vinted (Gmail en lecture seule, jamais le mot de passe Vinted) et garde les données sur le téléphone. Outil indépendant, sans lien avec Vinted.

## Pages
- [Présentation](${SITE}/decouvrir/): fonctions, installation, questions fréquentes
- [Calculateur de bénéfice Vinted](${SITE}/calculateur-benefice-vinted/): bénéfice et marge d'une vente
- [Calculer son vrai bénéfice sur Vinted](${SITE}/guides/calculer-benefice-vinted/)
- [Imprimer tous ses bordereaux Vinted d'un coup](${SITE}/guides/imprimer-bordereaux-vinted/)
- [Suivre ses ventes Vinted sans tableur](${SITE}/guides/suivre-ventes-vinted-sans-tableur/)
- [Fixer le bon prix de revente sur Vinted](${SITE}/guides/prix-revente-vinted/)
- [Acheter un lot : le coût de chaque article](${SITE}/guides/rentabiliser-lot-vinted/)
- [Confidentialité](${SITE}/confidentialite.html)

## Faits
- Prix : gratuit, sans abonnement
- Plateformes : iOS, Android, Web (application à installer depuis le navigateur)
- Données : stockées sur l'appareil de l'utilisateur
- Instagram : https://www.instagram.com/cngvinted/
`;

for (const [file, html] of Object.entries(pages)) {
  const p = join(OUT, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html);
}
writeFileSync(join(OUT, 'robots.txt'), ROBOTS);
writeFileSync(join(OUT, 'sitemap.xml'), SITEMAP);
writeFileSync(join(OUT, 'llms.txt'), LLMS);
console.log('Pages publiques générées :', Object.keys(pages).length);
