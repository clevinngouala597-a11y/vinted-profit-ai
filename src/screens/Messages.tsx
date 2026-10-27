import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { saveSettings } from '../lib/actions';
import { getDb } from '../lib/db';
import { centsToInput } from '../lib/money';
import { queryParam } from '../lib/router';
import { fillTemplate, templatesWithOverrides } from '../lib/templates';
import { useData } from '../lib/useData';
import type { VintedEvent } from '../lib/vinted/parse';
import { Field, PageHeader, useUI } from '../ui/kit';

/** Messages prêts à copier-coller dans Vinted (aucun envoi automatique, aucun risque pour le compte). */
export function Messages() {
  const ds = useData();
  const ui = useUI();
  const saleId = queryParam('vente');
  const sale = saleId ? ds.sales.find((s) => s.id === saleId) : undefined;
  const item = sale ? ds.items.find((i) => i.id === ds.saleLines.find((l) => l.saleId === sale.id)?.itemId) : undefined;
  // pseudo de l'acheteur : lu dans l'e-mail « Ton article s'est vendu »
  const buyer = useLiveQuery(async () => {
    if (!saleId) return '';
    const rows = await getDb().syncedEmails.toArray();
    const ev = rows.find((r) => r.ref === saleId && r.kind === 'sale')?.event as (VintedEvent & { kind: 'sale' }) | undefined;
    return ev?.buyer ?? '';
  }, [saleId]);
  const [acheteur, setAcheteur] = useState<string | null>(null);
  const [article, setArticle] = useState(item?.name ?? '');
  const [prix, setPrix] = useState(item?.targetPrice ? `${centsToInput(item.targetPrice)} €` : '');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const overrides = ds.settings.messageTemplates ?? {};
  const list = templatesWithOverrides(overrides);
  const groups = [...new Set(list.map((t) => t.group))];
  const who = acheteur ?? buyer ?? '';

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => ui.toast('Message copié : colle-le dans Vinted')).catch(() => ui.toast('Copie impossible'));
  const saveTpl = async (id: string, text: string | null) => {
    const next = { ...overrides };
    if (text === null) delete next[id]; else next[id] = text;
    await saveSettings({ messageTemplates: next });
    setEditing(null);
  };

  return (
    <>
      <PageHeader title="Messages" sub="Prêts à copier dans Vinted, en un toucher" backTo={saleId ? `ventes/${saleId}` : ''} />
      <div className="card">
        <div className="cols">
          <Field label="Acheteur"><input className="input" value={who} onChange={(e) => setAcheteur(e.target.value)} placeholder="pseudo" autoCapitalize="off" /></Field>
          <Field label="Prix"><input className="input" value={prix} onChange={(e) => setPrix(e.target.value)} placeholder="25 €" /></Field>
        </div>
        <Field label="Article"><input className="input" value={article} onChange={(e) => setArticle(e.target.value)} placeholder="Pull Lacoste marine" /></Field>
      </div>

      {groups.map((g) => (
        <div key={g}>
          <h2>{g}</h2>
          {list.filter((t) => t.group === g).map((t) => (
            <div key={t.id} className="card" style={{ marginBottom: 8 }}>
              <div className="row-between"><b style={{ fontSize: 14 }}>{t.label}{t.edited ? ' ✏️' : ''}</b>
                <button className="btn btn-ghost btn-sm" style={{ minHeight: 0, padding: '2px 10px' }} onClick={() => { setEditing(t.id); setDraft(t.text); }}>Modifier</button>
              </div>
              {editing === t.id ? (
                <>
                  <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 110, marginTop: 8 }} />
                  <p className="tiny faint">Variables : {'{acheteur}'}, {'{article}'}, {'{prix}'}</p>
                  <div className="btn-row">
                    <button className="btn btn-primary btn-sm" onClick={() => saveTpl(t.id, draft)}>Enregistrer</button>
                    {t.edited && <button className="btn btn-ghost btn-sm" onClick={() => saveTpl(t.id, null)}>Texte d’origine</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Annuler</button>
                  </div>
                </>
              ) : (
                <button onClick={() => copy(fillTemplate(t.text, { acheteur: who, article, prix }))} style={{ all: 'unset', display: 'block', cursor: 'pointer', marginTop: 6 }}>
                  <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{fillTemplate(t.text, { acheteur: who, article, prix })}</p>
                  <span className="tiny" style={{ color: 'var(--green)', fontWeight: 700 }}>Toucher pour copier</span>
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
