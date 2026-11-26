import type { Balance, Stage } from './production';

export const onSiteStages = ['raw', 'ready', 'hold', 'office_stock'] as const satisfies readonly Stage[];
export const artistStages = ['artist', 'reprint'] as const satisfies readonly Stage[];

export const stockMetrics = {
    on_site: { label: 'Physically in factory / office', stages: [...onSiteStages] },
    with_artists: { label: 'With artists', stages: [...artistStages] },
    custody: { label: 'Total in our custody', stages: [...onSiteStages, ...artistStages] },
    ready: { label: 'Ready to Dispatch', stages: ['ready'] },
} satisfies Record<string, { label: string; stages: Stage[] }>;

export type StockMetric = keyof typeof stockMetrics;
export type StockBreakdown = {
    from: string;
    asOf: string;
    current: number;
    opening: number;
    movements: { kind: string; added: number; removed: number }[];
    balances: Balance[];
};
export type AgedStock = Balance & { date: string | null };
export type CompanyPayment = {
    company: string;
    date: string;
    kind: string;
    amount: number;
};
export type PerformanceData = {
    asOf: string;
    stock: AgedStock[];
    companies: {
        company: string;
        paid: number;
        balance: number;
        lastPaid: string | null;
        averageDays: number | null;
        oldestUnpaidDays: number | null;
    }[];
};

export function daysBetween(from: string, to: string) {
    return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
}

export const artistRatings = ['Very good', 'Good', 'Not good', 'Very bad'] as const;
export const rawRatings = ['OK', 'Late', 'Very late', 'Extreme late'] as const;
export function stockAgeBand(days: number) {
    return days <= 10 ? 0 : days < 15 ? 1 : days < 20 ? 2 : 3;
}

type PendingAmount = { remaining: number; date: string; kind: string };

export function companyPaymentPerformance(rows: CompanyPayment[], asOf: string): PerformanceData['companies'] {
    const byCompany = new Map<string, CompanyPayment[]>();
    for (const row of rows) {
        const list = byCompany.get(row.company) ?? [];
        list.push(row);
        byCompany.set(row.company, list);
    }

    return [...byCompany].map(([company, entries]) => {
        const debits: PendingAmount[] = [];
        const credits: PendingAmount[] = [];
        let debitIndex = 0;
        let creditIndex = 0;
        let balance = 0;
        let paid = 0;
        let lastPaid: string | null = null;
        let matchedCash = 0;
        let weightedDays = 0;

        // The company ledger has no bill links. Match oldest open amounts for reporting only.
        for (const entry of entries) {
            const amount = Number(entry.amount);
            if (!amount) continue;
            balance += amount;
            if (entry.kind === 'payment' && amount < 0) {
                paid -= amount;
                lastPaid = entry.date;
            }
            const item = { remaining: Math.abs(amount), date: entry.date, kind: entry.kind };
            if (amount > 0) debits.push(item);
            else credits.push(item);

            while (debitIndex < debits.length && creditIndex < credits.length) {
                const debit = debits[debitIndex];
                const credit = credits[creditIndex];
                const matched = Math.min(debit.remaining, credit.remaining);
                if (debit.kind === 'bill' && credit.kind === 'payment') {
                    matchedCash += matched;
                    weightedDays += daysBetween(debit.date, credit.date) * matched;
                }
                debit.remaining -= matched;
                credit.remaining -= matched;
                if (!debit.remaining) debitIndex++;
                if (!credit.remaining) creditIndex++;
            }
        }

        const oldestBill = debits.slice(debitIndex).find(item => item.kind === 'bill');
        return {
            company, paid, balance, lastPaid,
            averageDays: matchedCash ? weightedDays / matchedCash : null,
            oldestUnpaidDays: oldestBill ? daysBetween(oldestBill.date, asOf) : null,
        };
    });
}
