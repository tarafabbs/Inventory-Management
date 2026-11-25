import { accountKey, type Balance, type Command } from './production';

export type ArtisanReceiptDraft = {
    artisan: string;
    company: string;
    date: string;
    quantities: Record<string, number>;
    disputed: boolean;
    disputes: Record<string, number>;
    notes: string;
};

export const artisanPending = (balances: Balance[], artisan: string) => balances.filter(b =>
    !!artisan && b.artisan === artisan && b.quantity > 0 && ['artist', 'reprint'].includes(b.stage));

export function artisanReceiptCommand(draft: ArtisanReceiptDraft, balances: Balance[]): Command {
    const available = artisanPending(balances, draft.artisan).filter(b => b.pool === 'normal' && b.company === draft.company);
    if (!available.length) throw new Error('This artisan has no pending production stock for this company.');
    const byKey = new Map(available.map(b => [accountKey(b), b]));
    const lines = Object.entries(draft.quantities).filter(([, n]) => n !== 0).map(([key, quantity]) => {
        const source = byKey.get(key);
        if (!source) throw new Error('Available stock changed or the quantity exceeds this balance. Reload and review.');
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > source.quantity)
            throw new Error('Quantity exceeds remaining stock.');
        const disputeQuantity = draft.disputed ? (draft.disputes[key] || 0) : 0;
        if (!Number.isSafeInteger(disputeQuantity) || disputeQuantity < 0 || disputeQuantity > quantity)
            throw new Error('Dispute quantity must be a whole number within the received quantity.');
        // Balance-only fields must not become part of the posting's source identity.
        const { company, product, pool, stage, artisan, arts, work } = source;
        return { source: { company, product, pool, stage, artisan, arts, work }, quantity, disputeQuantity };
    });
    if (!lines.length) throw new Error('Enter the quantity received for at least one category.');
    if (draft.disputed && (!lines.some(l => l.disputeQuantity > 0) || Object.entries(draft.disputes).some(([key, n]) => n !== 0 && !lines.some(l => accountKey(l.source) === key))))
        throw new Error('Dispute quantity must be a whole number within the received quantity.');
    return { kind: 'receive', date: draft.date, company: draft.company, notes: draft.notes, lines };
}
