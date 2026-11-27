// Quantity accounts describe custody, never a challan or a physical-piece code.
export const stages = ['raw', 'ready', 'hold', 'artist', 'reprint', 'damaged', 'delivered', 'raw_returned', 'office_pending', 'office_stock', 'office_sold', 'office_return'] as const;
export type Stage = typeof stages[number];
export type Account = {
    company: string;
    product: string;
    pool: 'normal' | 'company_return';
    stage: Stage;
    artisan: string;
    arts: string;
    work: string;
};
export type Balance = Account & {
    quantity: number;
    since?: string;
};
export type Delta = Account & {
    quantity: number;
};
export type Line = {
    source?: Account;
    company?: string;
    product?: string;
    quantity: number;
    artwork?: string;
    preferred?: string;
    outcome?: 'ready' | 'hold' | 'raw';
    disputeQuantity?: number;
    pool?: 'normal' | 'company_return';
    artisan?: string;
    adjustment?: 'shortage' | 'surplus';
};
export type Command = {
    kind: string;
    date: string;
    reference?: string;
    notes?: string;
    company?: string;
    product?: string;
    amount?: number;
    lines?: Line[];
    targetCompany?: string;
    document?: string;
    settlement?: string;
    confirm?: boolean;
    openingDue?: number;
    reason?: string;
    identifiedArtist?: string;
    factoryDamage?: boolean;
    correctionKind?: string;
    effectiveDelta?: Delta[];
    effectiveMoney?: {company:string;amount:number;kind:string}[];
    effectiveArtisanMoney?: {artisan:string;amount:number;kind:string}[];
    originalCreatedAt?: string;
    originalActorId?: string;
};
export type Document = {
    voided?: boolean;
    id: string;
    kind: string;
    company: string;
    quantity: number;
    settled: number;
    amount: number;
    payload: Command;
    created_at?: string;
};
export type Plan = {
    artisanMoney?: {artisan:string;amount:number;kind:string}[];
    deltas: Delta[];
    money: {
        company: string;
        amount: number;
        kind: string;
    }[];
    damage?: {
        company: string;
        quantity: number;
    };
    settle?: {
        id: string;
        quantity: number;
        amount: number;
    };
    order?: {
        company: string;
        quantity: number;
    };
    orderReceive?: string;
    damageSettle?: {id:string;quantity:number};
};
export const labels: Record<Stage, string> = { raw: 'Raw / White', ready: 'Ready to Dispatch', hold: 'Factory Dispute / Hold', artist: 'With Artist', reprint: 'Internal Reprint', damaged: 'Total Damage', delivered: 'With Company', raw_returned: 'Raw Dispute Returned', office_pending: 'Awaiting Office', office_stock: 'Office Stock', office_sold: 'Sold', office_return: 'Return to Workshop' };
export const normalizeArts = (s: string) => Array.from(new Set(s.split('+').map(x => x.trim()).filter(Boolean))).sort().join(' + ');
export const accountKey = (a: Account) => JSON.stringify([a.company, a.product, a.pool, a.stage, a.artisan || '', normalizeArts(a.arts || ''), a.work || '']);
export const quantity = (n: unknown) => { if (!Number.isSafeInteger(n) || Number(n) < 1 || Number(n) > 1000000)
    throw new Error('Quantity must be a whole number from 1 to 1,000,000.'); return Number(n); };
export const paise = (n: unknown) => { if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e10 || Math.abs(n * 100 - Math.round(n * 100)) > 0.0001)
    throw new Error('Enter a valid amount with at most two decimals.'); return Math.round(n * 100); };
export const actions: Record<string, {
    label: string;
    permission: string;
}> = {
    receipt: { label: 'New Entry', permission: 'receipt' }, issue: { label: 'Send to Artist', permission: 'handoff' }, additional: { label: 'Additional Artwork', permission: 'handoff' }, receive: { label: 'Receive from Artist', permission: 'return' },
    dispute: { label: 'Identify Factory Dispute', permission: 'dispute' }, reprint: { label: 'Send Internal Reprint', permission: 'reprintOut' }, damage: { label: 'Total Damage', permission: 'dispute' },
    dispatch: { label: 'Bill & Dispatch', permission: 'postFinish' }, company_return: { label: 'Receive Company Return', permission: 'postFinish' }, return_send: { label: 'Company Return · Artist Send', permission: 'reprintOut' }, return_receive: { label: 'Company Return · Artist Receive', permission: 'reprintReceive' },
    opening: { label: 'Opening Balance', permission: 'manageData' }, payment: { label: 'Company Payment', permission: 'manageData' }, replacement: { label: 'Replacement from Own Stock', permission: 'manageData' }, order: { label: 'Order from Outside', permission: 'manageData' }, order_receive: { label: 'Receive Replacement Order', permission: 'manageData' }, settle: { label: 'Damage Settlement', permission: 'manageData' },
    office_send: { label: 'Send Own Product to Office', permission: 'postFinish' }, office_receive: { label: 'Receive Item at Office', permission: 'officeReceive' }, office_vendor: { label: 'Outside Vendor Receipt', permission: 'officeEntry' }, office_sell: { label: 'Office Sale', permission: 'officeSell' }, office_return: { label: 'Return Fresh Item to Factory', permission: 'officeReturn' }, office_dispute_return: { label: 'Dispute Return to Factory', permission: 'officeReturn' }, office_factory_receive: { label: 'Receive Office Return', permission: 'postFinish' }, vendor_return: { label: 'Return to Outside Vendor', permission: 'officeEntry' }, stock_count: { label: 'Physical Stock Correction', permission: 'adjust' },
};
export function planCommand(c: Command, balances: Balance[], documents: Document[] = []): Plan {
    if (!actions[c.kind])
        throw new Error('Choose a valid action.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || new Date(c.date + 'T00:00:00Z').toISOString().slice(0, 10) !== c.date)
        throw new Error('Choose a valid date.');
    if (c.date > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))
        throw new Error('Date cannot be in the future.');
    const p: Plan = { deltas: [], money: [] };
    const current = new Map(balances.map(b => [accountKey(b), b.quantity]));
    const receiptSources = new Map<string, number>();
    const add = (a: Account, n: number) => { if (!a.company || !a.product || !stages.includes(a.stage) || !['normal', 'company_return'].includes(a.pool))
        throw new Error('Choose a valid company, product and stock account.'); if (a.pool === 'company_return' && !['hold', 'artist', 'ready', 'damaged'].includes(a.stage))
        throw new Error('Invalid Company Return location.'); const artist = ['artist', 'reprint'].includes(a.stage); if (artist !== !!a.artisan || (!artist && !!a.work))
        throw new Error('Choose the artist and artwork for artist-held stock only.'); const clean = { ...a, arts: normalizeArts(a.arts || '') }; const key = accountKey(clean); const next = (current.get(key) || 0) + n; if (next < 0)
        throw new Error('Available stock changed or the quantity exceeds this balance. Reload and review.'); current.set(key, next); p.deltas.push({ ...clean, quantity: n }); };
    const move = (a: Account, b: Account, n: number) => { add(a, -n); add(b, n); };
    const account = (l: Line, stage: Stage, pool: Account['pool'] = 'normal'): Account => ({ company: l.company || c.company || '', product: l.product || '', pool, stage, artisan: '', arts: '', work: '' });
    const lines = c.lines || [];
    const monetary = ['payment', 'settle', 'order'];
    if (!monetary.includes(c.kind) && !lines.length && !(c.kind === 'opening' && c.openingDue !== undefined))
        throw new Error('Add at least one product line.');
    if (lines.length > 100)
        throw new Error('Use at most 100 lines per entry.');
    const source = (l: Line, allowed: Stage[], pool?: Account['pool']) => { const a = l.source; if (!a || !allowed.includes(a.stage) || (pool && a.pool !== pool))
        throw new Error('Choose an eligible source stock.'); return a; };
    for (const l of lines) {
        const n = quantity(l.quantity);
        let a: Account;
        switch (c.kind) {
            case 'receipt':
                add(account(l, 'raw'), n);
                break;
            case 'opening':
                if (!c.confirm)
                    throw new Error('Review and confirm the opening balance.');
                if (!l.source)
                    throw new Error('Choose opening stock location.');
                if (['artist', 'reprint'].includes(l.source.stage) && !l.source.work)
                    throw new Error('Choose pending artwork.');
                add(l.source, n);
                if (l.source.stage === 'damaged') {
                    if (p.damage && p.damage.company !== l.source.company)
                        throw new Error('One company per damage opening.');
                    p.damage = { company: l.source.company, quantity: (p.damage?.quantity || 0) + n };
                }
                break;
            case 'issue':
            case 'additional':
            case 'reprint':
            case 'return_send':
                a = source(l, c.kind === 'issue' ? ['raw'] : c.kind === 'additional' ? ['ready'] : c.kind === 'reprint' ? ['ready', 'hold'] : ['hold', 'ready'], c.kind === 'return_send' ? 'company_return' : 'normal');
                if (!l.artisan || !l.artwork?.trim())
                    throw new Error('Choose artist and actual artwork.');
                move(a, { ...a, stage: c.kind === 'reprint' ? 'reprint' : 'artist', artisan: l.artisan, work: l.artwork.trim() }, n);
                break;
            case 'receive':
            case 'return_receive':
                a = source(l, ['artist', 'reprint'], c.kind === 'receive' ? 'normal' : 'company_return');
                {
                    const key = accountKey(a);
                    const received = (receiptSources.get(key) || 0) + n;
                    if (received > (balances.find(b => accountKey(b) === key)?.quantity || 0))
                        throw new Error('Available stock changed or the quantity exceeds this balance. Reload and review.');
                    receiptSources.set(key, received);
                }
                if (l.disputeQuantity !== undefined) {
                    const disputed = l.disputeQuantity;
                    if (c.kind !== 'receive' || l.outcome === 'hold' || !Number.isSafeInteger(disputed) || disputed < 0 || disputed > n)
                        throw new Error('Dispute quantity must be a whole number within the received quantity.');
                    // One physical account per piece: repaint is also shown in the
                    // Factory Dispute view, never duplicated into a hold balance.
                    add(a, -n);
                    if (n > disputed)
                        add({ ...a, stage: 'ready', artisan: '', work: '', arts: normalizeArts(a.arts + ' + ' + a.work) }, n - disputed);
                    if (disputed)
                        add({ ...a, stage: 'reprint' }, disputed);
                    break;
                }
                move(a, { ...a, stage: l.outcome === 'hold' ? 'hold' : 'ready', artisan: '', work: '', arts: l.outcome === 'hold' ? a.arts : normalizeArts(a.arts + ' + ' + a.work) }, n);
                break;
            case 'dispute':
                a = source(l, ['raw', 'ready'], 'normal');
                move(a, { ...a, stage: c.factoryDamage ? 'damaged' : 'hold' }, n);
                if (c.factoryDamage) {
                    if (!c.notes?.trim())
                        throw new Error('Describe total damage.');
                    if (p.damage && p.damage.company !== a.company)
                        throw new Error('One company per damage record.');
                    p.damage = { company: a.company, quantity: (p.damage?.quantity || 0) + n };
                }
                break;
            case 'damage':
                a = source(l, ['raw', 'ready', 'hold'], 'normal');
                move(a, { ...a, stage: 'damaged' }, n);
                if (!c.notes?.trim())
                    throw new Error('Describe the damage.');
                if (p.damage && p.damage.company !== a.company)
                    throw new Error('Record damage for one company at a time.');
                p.damage = { company: a.company, quantity: (p.damage?.quantity || 0) + n };
                break;
            case 'dispatch':
                a = source(l, ['ready', 'hold']);
                if (a.stage === 'hold' && (a.pool !== 'normal' || a.arts))
                    throw new Error('Only unworked raw dispute may be returned from hold.');
                move(a, { ...a, pool: 'normal', stage: a.stage === 'hold' ? 'raw_returned' : 'delivered', artisan: '', work: '' }, n);
                if (c.company && c.company !== a.company)
                    throw new Error('One company per bill.');
                if (!c.company)
                    c.company = a.company;
                break;
            case 'company_return':
                a = source(l, ['delivered'], 'normal');
                move(a, { ...a, pool: 'company_return', stage: 'hold' }, n);
                break;
            case 'replacement':
                a = source(l, ['raw', 'ready'], 'normal');
                if (!c.targetCompany || c.targetCompany === a.company)
                    throw new Error('Choose the company receiving replacement.');
                move(a, { ...a, company: c.targetCompany }, n);
                break;
            case 'order_receive':
                if (!c.document)
                    throw new Error('Choose replacement order.');
                add(account(l, l.outcome === 'ready' ? 'ready' : 'raw'), n);
                p.orderReceive = c.document;
                break;
            case 'office_send':
                a = source(l, ['ready'], 'normal');
                move(a, { ...a, stage: 'office_pending' }, n);
                break;
            case 'office_receive':
                a = source(l, ['ready', 'office_pending'], 'normal');
                move(a, { ...a, stage: 'office_stock' }, n);
                break;
            case 'office_vendor':
                add(account(l, 'office_stock'), n);
                break;
            case 'office_sell':
                a = source(l, ['office_stock']);
                move(a, { ...a, stage: 'office_sold' }, n);
                break;
            case 'office_return':
                a = source(l, ['office_stock'], 'normal');
                move(a, { ...a, stage: 'ready' }, n);
                break;
            case 'office_dispute_return':
                if (!c.notes?.trim()) throw new Error('Describe the office dispute.');
                a = source(l, ['office_stock'], 'normal');
                move(a, { ...a, stage: 'hold' }, n);
                break;
            case 'office_factory_receive':
                a = source(l, ['office_return']);
                move(a, { ...a, stage: 'hold' }, n);
                break;
            case 'vendor_return':
                a = source(l, ['office_stock']);
                move(a, { ...a, stage: 'raw_returned' }, n);
                break;
            case 'stock_count':
                if (!c.notes?.trim())
                    throw new Error('A stock correction reason is required.');
                a = source(l, ['raw', 'ready', 'hold', 'office_stock']);
                add(a, (l.adjustment || c.reason || 'shortage') === 'shortage' ? -n : n);
                break;
            default: throw new Error('This action does not accept product lines.');
        }
    }
    if(p.damage&&new Set(lines.map(l=>l.source?.product)).size>1)throw new Error('Record damage separately for each product category.');
    if (c.kind === 'dispatch')
        p.money.push({ company: c.company || '', amount: paise(c.amount ?? 0), kind: 'bill' });
    if (['receive','return_receive'].includes(c.kind)) {
        const amount=paise(c.amount??0);
        if(amount){
            const artists=new Set(lines.map(l=>l.source?.artisan).filter(Boolean));
            if(artists.size!==1)throw new Error('Record a work charge for one artisan at a time.');
            p.artisanMoney=[{artisan:[...artists][0]!,amount,kind:'charge'}];
        }
    }
    if (c.kind === 'payment') {
        const amount = paise(c.amount);
        if (!amount || !c.company)
            throw new Error('Choose company and payment amount.');
        p.money.push({ company: c.company, amount: -amount, kind: 'payment' });
    }
    if (c.kind === 'opening' && c.openingDue !== undefined) {
        if (!c.confirm || !c.company)
            throw new Error('Confirm company opening balance.');
        const n = c.openingDue;
        if (!Number.isFinite(n))
            throw new Error('Enter opening amount.');
        p.money.push({ company: c.company, amount: Math.sign(n) * paise(Math.abs(n)), kind: 'opening' });
    }
    if (c.kind === 'order') {
        if(!c.product)throw new Error('Choose the replacement product category.');
        if (!c.company || !c.notes?.trim())
            throw new Error('Choose company and enter vendor / specification in remarks.');
        const damage=documents.find(d=>d.id===c.document&&d.kind==='damage');
        if(!damage||damage.company!==c.company||damage.payload.lines?.[0]?.source?.product!==c.product||quantity(Number(c.reason))>damage.quantity-damage.settled)throw new Error('Link this order to unsettled damage of the same company and category.');
        p.order = { company: c.company, quantity: quantity(Number(c.reason)) };
        paise(c.amount ?? 0);
    }
    if (['replacement', 'settle', 'order_receive'].includes(c.kind)) {
        const d = documents.find(x => x.id === c.document);
        if (!d || d.kind !== (c.kind === 'order_receive' ? 'order' : 'damage'))
            throw new Error('Choose the unsettled damage / order.');
        if(c.kind==='replacement'&&lines.some(l=>l.source?.product!==d.payload.lines?.[0]?.source?.product))throw new Error('Replacement category must match the damaged product.');
        if(c.kind==='order_receive'&&lines.some(l=>l.product!==d.payload.product))throw new Error('Receive the category ordered for replacement.');
        if (c.kind === 'replacement' && d.company !== c.targetCompany)
            throw new Error('Replacement must go to the damaged company.');
        if (c.kind === 'order_receive') {
            const n = lines.reduce((s, l) => s + l.quantity, 0);
            if (d.settled + n > d.quantity || lines.some(l => (l.company || c.company) !== d.company))
                throw new Error('Receipt exceeds the remaining replacement order.');
            const damage=documents.find(x=>x.id===d.payload.document&&x.kind==='damage');
            if(!damage||damage.settled+n>damage.quantity)throw new Error('The linked damage is already settled or this receipt exceeds its pending quantity.');
            p.damageSettle={id:damage.id,quantity:n};
            p.settle = { id: d.id, quantity: n, amount: 0 };
        }
        else {
            const n = c.kind === 'replacement' ? lines.reduce((s, l) => s + l.quantity, 0) : quantity(Number(c.reason));
            if (n + d.settled > d.quantity)
                throw new Error('Settlement exceeds unsettled damage quantity.');
            const amount = c.kind === 'settle' ? paise(c.amount ?? 0) : 0;
            if (c.kind === 'settle' && !['cash', 'due', 'waived'].includes(c.settlement || ''))
                throw new Error('Choose settlement method.');
            if (!c.notes?.trim())
                throw new Error('Settlement remarks are required.');
            if (c.kind === 'settle' && c.settlement === 'due') {
                if (!amount)
                    throw new Error('Enter the due adjustment amount.');
                p.money.push({ company: d.company, amount: -amount, kind: 'damage_adjustment' });
            }
            p.settle = { id: d.id, quantity: n, amount };
        }
    }
    return p;
}
