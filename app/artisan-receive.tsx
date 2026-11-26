'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInventoryLanguage } from './inventory-language';
import { accountKey, type Command } from '@/lib/production';
import { artisanPending, artisanReceiptCommand, type ArtisanReceiptDraft } from '@/lib/artisan-receive';
import type { Snapshot } from '@/lib/production-types';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const empty = (): ArtisanReceiptDraft => ({ artisan: '', company: '', date: today(), quantities: {}, disputed: false, disputes: {}, notes: '', amount: 0, reference: '' });
const total = (rows: { quantity: number }[]) => rows.reduce((s, b) => s + b.quantity, 0);

export default function ArtisanReceive({ data, busy, save }: {
    data: Snapshot;
    busy: boolean;
    save: (command: Command, key: string) => Promise<unknown>;
}) {
    const { t: tr } = useInventoryLanguage();
    const [draft, setDraft] = useState<ArtisanReceiptDraft>(empty);
    const [error, setError] = useState('');
    const [hydrated, setHydrated] = useState(false);
    const [restored, setRestored] = useState(false);
    const [retryCommand, setRetryCommand] = useState<Command | null>(null);
    const key = useRef('');
    const pending = useRef(false);
    const storage = 'ims-artisan-receive-v2:' + data.user.id;
    useEffect(() => {
        try {
            const saved = JSON.parse(sessionStorage.getItem(storage) || 'null');
            if (saved?.draft?.artisan) {
                setDraft({ ...empty(), ...saved.draft });
                key.current = saved.key || '';
                if (saved.key && saved.command?.kind === 'receive') setRetryCommand(saved.command);
                setRestored(true);
            }
        } catch { /* A blocked storage API does not prevent stock entry. */ }
        setHydrated(true);
    }, [storage]);
    useEffect(() => {
        if (hydrated) try { sessionStorage.setItem(storage, JSON.stringify({ draft, key: key.current, command: retryCommand })); } catch { /* Optional draft storage. */ }
    }, [draft, storage, hydrated, retryCommand]);
    const change = (patch: Partial<ArtisanReceiptDraft>) => {
        key.current = '';
        setRetryCommand(null);
        setDraft(d => ({ ...d, ...patch }));
        setError('');
    };
    const held = artisanPending(data.balances, draft.artisan);
    const production = held.filter(b => b.pool === 'normal');
    const companies = data.companies.filter(c => production.some(b => b.company === c.id));
    const rows = production.filter(b => b.company === draft.company);
    const received = rows.reduce((s, b) => s + (draft.quantities[accountKey(b)] || 0), 0);
    const disputed = draft.disputed ? rows.reduce((s, b) => s + (draft.disputes[accountKey(b)] || 0), 0) : 0;
    const companyName = (id: string) => data.companies.find(c => c.id === id)?.name || id;
    const productName = (id: string) => data.products.find(p => p.id === id)?.name || id;

    async function submit(e?: FormEvent) {
        e?.preventDefault();
        if (pending.current || busy) return;
        setError('');
        try {
            // Recheck an uncertain save with its exact original payload/key even
            // if a reload now shows depleted stock. The API resolves idempotency
            // before posting or validating current balances.
            const command = retryCommand || artisanReceiptCommand(draft, data.balances);
            key.current ||= crypto.randomUUID();
            setRetryCommand(command);
            try { sessionStorage.setItem(storage, JSON.stringify({ draft, key: key.current, command })); } catch { /* Optional. */ }
            pending.current = true;
            await save(command, key.current);
            setDraft(empty());
            setRestored(false);
            setRetryCommand(null);
            key.current = '';
            try { sessionStorage.removeItem(storage); } catch { /* Optional. */ }
        } catch (e) {
            setError((e as Error).message);
        } finally { pending.current = false; }
    }

    return <form className="prod-form artisan-receive" onSubmit={submit}>
        <fieldset disabled={busy}>
            {restored && <p>{tr('Unsaved draft restored.')}</p>}
            {retryCommand && <p className="prod-preview">{tr('Check the previous save before starting another receipt.')} <button type="button" onClick={() => void submit()}>{tr('Check / retry previous save')}</button></p>}
            <label>{tr('Select artisan first')}<select required value={draft.artisan} onChange={e => change({ ...empty(), artisan: e.target.value })}>
                <option value="">{tr('Select artist')}</option>
                {data.artisans.filter(a=>a.active||total(artisanPending(data.balances,a.id))>0||a.id===draft.artisan).map(a => <option key={a.id} value={a.id}>{a.name} · {total(artisanPending(data.balances, a.id))} {tr('pcs pending')}</option>)}
            </select></label>
            {!draft.artisan && <p className="prod-preview">{tr('Choose an artisan to see their companies, categories and pending quantities.')}</p>}
            {!!draft.artisan && <>
                <div className="prod-metrics receipt-totals" aria-live="polite">
                    <section><small>{tr('Total pending with artisan')}</small><strong>{total(held)} {tr('pcs')}</strong></section>
                    <section><small>{tr('Main Production')}</small><strong>{total(production)} {tr('pcs')}</strong></section>
                    <section><small>{tr('Internal Reprint')}</small><strong>{total(production.filter(b => b.stage === 'reprint'))} {tr('pcs')}</strong></section>
                    <section><small>{tr('Company Return — Separate Stock')}</small><strong>{total(held.filter(b => b.pool === 'company_return'))} {tr('pcs')}</strong></section>
                </div>
                {production.length === 0 && <p role="status" className="prod-preview">{tr('No pending production stock. Entry is disabled. Receive company-return repairs from Company Return.')}</p>}
                {production.length > 0 && <div className="receipt-company-summary">
                    {companies.map(c => <section key={c.id}><h3>{c.name} · {total(production.filter(b => b.company === c.id))} {tr('pcs pending')}</h3>
                        <p>{data.products.filter(p => production.some(b => b.company === c.id && b.product === p.id)).map(p => `${p.name}: ${total(production.filter(b => b.company === c.id && b.product === p.id))} ${tr('pcs')}`).join(' · ')}</p>
                    </section>)}
                </div>}
            </>}
            <fieldset disabled={!production.length} className="receipt-details">
                <div className="prod-fields"><label>{tr('Company / Party')}<select required value={draft.company} onChange={e => change({ company: e.target.value, quantities: {}, disputes: {}, disputed: false })}>
                    <option value="">{tr('Select company')}</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name} · {total(production.filter(b => b.company === c.id))} {tr('pcs pending')}</option>)}
                </select></label><label>{tr('Date')}<input type="date" required max={today()} value={draft.date} onChange={e => change({ date: e.target.value })}/></label></div>
                <fieldset disabled={!rows.length}>
                    <h2>{tr('Category-wise receipt')}</h2>
                    <p>{tr('Enter received quantities only. Leave other categories at zero. Different artworks stay separate.')}</p>
                    <div className="receipt-stock-list">{rows.map(b => {
                        const id = accountKey(b), n = draft.quantities[id] || 0;
                        return <section key={id} className="receipt-stock-row">
                            <div><h3>{productName(b.product)} · {b.work}</h3><p>{companyName(b.company)} · {b.stage === 'reprint' ? tr('Internal Reprint') : tr('With Artist')}</p><small>{tr('Completed:')} {b.arts || tr('No completed art')}</small></div>
                            <div className="receipt-quantity"><strong>{tr('Available')} {b.quantity} {tr('pcs')}</strong><label>{tr('Quantity received')} · {productName(b.product)} · {b.work} · {tr(b.stage === 'reprint' ? 'Internal Reprint' : 'With Artist')}
                                <input type="number" inputMode="numeric" min="0" max={b.quantity} step="1" value={n} onChange={e => change({ quantities: { ...draft.quantities, [id]: Number(e.target.value) } })}/>
                            </label><small>{tr('Still with artisan before repaint:')} {b.quantity - n} {tr('pcs')}</small></div>
                        </section>;
                    })}</div>
                    <div className="prod-fields"><label>{tr('Artisan bill / reference (optional)')}<input maxLength={200} value={draft.reference||''} onChange={e=>change({reference:e.target.value})}/></label><label>{tr('Artisan work charge (₹)')}<input type="number" min="0" step="0.01" value={draft.amount||0} onChange={e=>change({amount:Number(e.target.value)})}/></label></div>
                    <p>{tr('Work charge adds to artisan due. Payment is separate; existing advance automatically offsets this charge. Enter zero for free rework.')}</p>
                    <label>{tr('Remarks / Reason')}<textarea rows={2} value={draft.notes} onChange={e => change({ notes: e.target.value })}/></label>
                    <label className="prod-check"><input type="checkbox" checked={draft.disputed} onChange={e => change({ disputed: e.target.checked, disputes: {} })}/>{tr('Dispute — return part of this receipt to the same artisan for repaint')}</label>
                    {draft.disputed && <section className="receipt-dispute"><p>{tr('Disputed pieces go directly to artisan repaint and appear in Factory Disputes. They do not enter Ready to Dispatch or Company Return.')}</p>
                        {rows.filter(b => (draft.quantities[accountKey(b)] || 0) > 0).map(b => {
                            const id = accountKey(b);
                            return <label key={id}>{tr('Dispute quantity')} · {productName(b.product)} · {b.work} · {tr(b.stage === 'reprint' ? 'Internal Reprint' : 'With Artist')} ({tr('Quantity received')}: {draft.quantities[id]})<input type="number" inputMode="numeric" min="0" max={draft.quantities[id]} step="1" value={draft.disputes[id] || 0} onChange={e => change({ disputes: { ...draft.disputes, [id]: Number(e.target.value) } })}/></label>;
                        })}
                    </section>}
                    <div className="prod-preview" aria-live="polite"><p>{tr('Quantity received')}: {received} {tr('pcs')}</p><p>{tr('Ready to Dispatch')}: {received - disputed} {tr('pcs')}</p><p>{tr('Repaint pending')}: {disputed} {tr('pcs')}</p><p>{tr('Total pending with artisan')}: {total(held) - received + disputed} {tr('pcs')}</p></div>
                    <p>{tr('All filled quantities save together. No Add line step is needed.')}</p>
                    <button className="prod-primary" type="submit" disabled={received < 1}>{busy ? tr('Saving / Checking…') : tr('Save Receive from Artist')}</button>
                </fieldset>
            </fieldset>
            {error && <p className="prod-error" role="alert">{tr(error)}</p>}
        </fieldset>
    </form>;
}
