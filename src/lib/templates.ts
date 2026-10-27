/** Messages prêts à copier dans Vinted (aucun envoi automatique : le vendeur colle lui-même). */
export interface Template { id: string; group: string; label: string; text: string }

export const DEFAULT_TEMPLATES: Template[] = [
  { id: 'merci', group: 'Après la vente', label: 'Remerciement', text: "Merci beaucoup pour ton achat {acheteur} ! 🙏 Je prépare « {article} » avec soin et je l'envoie très vite. N'hésite pas si tu as la moindre question." },
  { id: 'envoye', group: 'Après la vente', label: 'Colis envoyé', text: "Hello {acheteur}, ton colis « {article} » est parti aujourd'hui 📦 Tu peux suivre l'acheminement depuis la conversation. Bonne journée !" },
  { id: 'avis', group: 'Après la vente', label: 'Demande d’avis', text: "Coucou {acheteur} ! J'espère que « {article} » te plaît 😊 Si tout est ok, un petit avis m'aiderait beaucoup. Merci et à bientôt sur mon dressing !" },
  { id: 'favori', group: 'Favoris et offres', label: 'Relance d’un favori', text: "Hello ! J'ai vu que « {article} » te plaisait 😊 Je peux te le faire à {prix} si ça t'intéresse, envoie-moi une offre !" },
  { id: 'contre', group: 'Favoris et offres', label: 'Contre-offre', text: "Merci pour ton offre ! Je ne peux pas descendre aussi bas, mais je te propose {prix}, frais de port en plus. Ça te va ?" },
  { id: 'lot', group: 'Favoris et offres', label: 'Proposer un lot', text: "Si tu prends plusieurs articles de mon dressing, je te fais une réduction sur le lot et tu ne paies qu'une seule fois les frais de port 😉" },
  { id: 'dispo', group: 'Questions', label: '« Encore disponible ? »', text: "Oui, « {article} » est toujours disponible ! Tu peux l'acheter directement ou m'envoyer une offre 🙂" },
  { id: 'mesures', group: 'Questions', label: 'Mesures', text: "Bonjour ! Voici les mesures de « {article} » prises à plat : longueur … cm, largeur aisselle à aisselle … cm. N'hésite pas si tu as besoin d'autre chose !" },
  { id: 'retard', group: 'Questions', label: 'Petit retard d’envoi', text: "Bonjour {acheteur}, désolé pour l'attente : je dépose ton colis « {article} » au plus tard demain. Merci pour ta patience 🙏" },
];

export function fillTemplate(text: string, v: { acheteur?: string | null; article?: string | null; prix?: string | null }) {
  return text
    .replace(/\{acheteur\}/g, v.acheteur?.trim() || '')
    .replace(/\{article\}/g, v.article?.trim() || 'cet article')
    .replace(/\{prix\}/g, v.prix?.trim() || '… €')
    .replace(/ +,/g, ',')
    .replace(/ {2,}/g, ' ');
}

export const templatesWithOverrides = (overrides: Record<string, string>) =>
  DEFAULT_TEMPLATES.map((t) => ({ ...t, text: overrides[t.id] ?? t.text, edited: overrides[t.id] !== undefined }));
