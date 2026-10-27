import { describe, expect, it } from 'vitest';
import { normalizeText, parseVintedEmail, titleSimilarity, type RawEmail } from '../src/lib/vinted/parse';

// E-mails FICTIFS reproduisant le format réel de Vinted (aucune donnée personnelle réelle)
const mail = (subject: string, text: string, date = '2026-10-22T09:10:49Z', id = 'm1'): RawEmail => ({ id, date, subject, text });

describe('Lecture des e-mails Vinted', () => {
  it('vente : la photo « [image: …] » de Gmail est ignorée', () => {
    const ev = parseVintedEmail({ id: 'x', date: '2026-10-04T00:32:55Z', subject: "Ton article s'est vendu !", text: 'Bonjour clevinnng, omidi a acheté [image: Montre argentée homme/femme - cadran effet CD multicolore] Montre argentée homme/femme - cadran effet CD multicolore 50,00 € Nous transférerons le paiement' });
    expect(ev).toMatchObject({ kind: 'sale', title: 'Montre argentée homme/femme - cadran effet CD multicolore', amount: 5000 });
  });

  it('vente (format tableau de Gmail)', () => {
    const e = parseVintedEmail(mail("Ton article s'est vendu !", `E-mail Vinted\n\n| Bonjour vendeur42, acheteuse_7 a acheté |\n| | Robe longue rose à fleurs - Taille S 80,00 € |\n\nNous transférerons le paiement sur ton porte-monnaie Vinted une fois la commande terminée.`));
    expect(e).toMatchObject({ kind: 'sale', title: 'Robe longue rose à fleurs - Taille S', amount: 8000, buyer: 'acheteuse_7', date: '2026-10-22' });
  });

  it('vente (texte brut, apostrophe typographique, montant avec milliers)', () => {
    const e = parseVintedEmail(mail('Ton article s’est vendu !', 'Bonjour vendeur42,\nbob a acheté\nVeste en cuir vintage – Taille L\n1 249,00 €\nNous transférerons…'));
    expect(e).toMatchObject({ kind: 'sale', title: 'Veste en cuir vintage – Taille L', amount: 124900 });
  });

  it('transaction finalisée : montant viré et n° de transaction', () => {
    const e = parseVintedEmail(mail('La transaction est finalisée', '### vendeur42, #### Cette transaction est finalisée. #### La vente de Coupe-vent à carreaux - Taille L a été réalisée avec succès. N° de Transaction : #23000000001 Date : 25/10/2026 13 h 07 |\n| Montant de la commande : | 65,00 € |\n| Viré sur ton compte Vinted : | 63,50 € |', '2026-10-25T23:30:00Z'));
    // 23 h 30 UTC = 00 h 30 le 26/10 à Paris (heure d'hiver depuis le 25/10)
    expect(e).toMatchObject({ kind: 'completed', title: 'Coupe-vent à carreaux - Taille L', amount: 6350, transaction: '23000000001', date: '2026-10-26' });
  });

  it('mises à jour de commande : annulation, expédition, autres ignorées', () => {
    expect(parseVintedEmail(mail('Commande mise à jour pour Chemise verte - Taille L', "Bonjour, La transaction a été annulée. L'acheteur va recevoir un remboursement."))).toMatchObject({ kind: 'cancelled', title: 'Chemise verte - Taille L' });
    expect(parseVintedEmail(mail('Commande mise à jour pour Gilet zippé - Taille M', "Bonjour, Ton colis est en cours d&#39;acheminement vers l&#39;acheteur ! La livraison est estimée au 15 juill."))).toMatchObject({ kind: 'shipped', title: 'Gilet zippé - Taille M' });
    expect(parseVintedEmail(mail('Commande mise à jour pour Gilet zippé - Taille M', 'Bonjour, Nous attendons que x récupère sa commande.'))).toBeNull();
  });

  it('facture de boost', () => {
    const e = parseVintedEmail(mail('Articles boostés : ta facture', '# Bonjour vendeur42, Tu as boosté 1 article avec succès. |\n| Boost international de 7 jours (1 article) | 2,75 € |\n| Total | 2,75 € |\n| Apple Pay |'));
    expect(e).toMatchObject({ kind: 'invoice', label: 'Boost international de 7 jours (1 article)', amount: 275 });
  });

  it("reçu d'achat : total payé, prix de l'article, vendeur", () => {
    const e = parseVintedEmail(mail('Ton reçu pour la commande « Porte-clé cuir »', '| Vendeur | vendeuse.test |\n| Commande | Porte-clé cuir |\n| Montant payé | 3,70 € |\n| Article | 1,00 € |\n| Frais de port | 2,83 € |\n| Frais de Protection acheteurs | 0,75 € |\n| Réduction | -0,88 € |'));
    expect(e).toMatchObject({ kind: 'purchase', title: 'Porte-clé cuir', total: 370, article: 100, seller: 'vendeuse.test' });
  });

  it('achat remboursé, et e-mails sans intérêt ignorés', () => {
    expect(parseVintedEmail(mail('La commande "Porte-clé cuir" a été remboursée !', 'Le paiement que tu as fait à x a été annulé.'))).toMatchObject({ kind: 'purchase_refund', title: 'Porte-clé cuir' });
    expect(parseVintedEmail(mail('Le transfert bancaire est en cours', 'Montant du transfert : 65,00 €'))).toBeNull();
    expect(parseVintedEmail(mail('Nouvelle offre pour Sweat - Taille M', 'Nouvelle offre : €12.00 au lieu de €20.00'))).toBeNull();
    expect(parseVintedEmail(mail("Ton article s'est vendu !", 'illisible'))).toBeNull();
  });

  it('normalisation et similarité des titres', () => {
    expect(normalizeText('a &#39;b&#39; | c\n\n d')).toBe("a 'b' c d");
    expect(titleSimilarity('Montre argentée homme/femme – cadran effet CD multicolore', 'Montre argentée homme/femme - cadran effet CD multicolore')).toBe(1);
    expect(titleSimilarity('Sweat à capuche gris - Taille L', 'Sweat gris capuche')).toBeGreaterThan(0.5);
    expect(titleSimilarity('Robe longue rose', 'Jean noir')).toBe(0);
    // nom court saisi dans l'app ↔ titre long de l'annonce Vinted
    expect(titleSimilarity('Jogging gris léopard', 'Jogging gris clair motif léopard - Taille L')).toBeGreaterThanOrEqual(0.75);
    // un seul mot ne suffit pas (trop vague)
    expect(titleSimilarity('Sweat', 'Sweat à capuche gris - Taille L')).toBeLessThan(0.75);
    // deux articles différents de même type restent distincts
    expect(titleSimilarity('Sweat gris Nike', 'Sweat noir Adidas - Taille M')).toBeLessThan(0.75);
  });
});
