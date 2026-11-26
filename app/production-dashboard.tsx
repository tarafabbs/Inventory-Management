'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { actions, labels } from '@/lib/production';
import { artistRatings, daysBetween, rawRatings, stockAgeBand, stockMetrics, type PerformanceData, type StockBreakdown, type StockMetric } from '@/lib/production-dashboard';
import type { Snapshot } from '@/lib/production-types';
import { useInventoryLanguage } from './inventory-language';

const number = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 });
const rupees = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
const movementNames: Record<string, string> = {
    correct: 'Corrections', delete: 'Reversed entries', reset: 'Quantity reset', undo_reset: 'Restored quantities',
};

function useDashboardReport<T>(query: string, snapshot: Snapshot) {
    const [result, setResult] = useState<{ query: string; snapshot: Snapshot; data?: T; error?: string }>();
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 18_000);
        let active = true;
        fetch('/api/production/dashboard?' + query, { cache: 'no-store', signal: controller.signal })
            .then(async response => {
                const body = await response.json();
                if (!response.ok) throw Error(body.error);
                if (active) setResult({ query, snapshot, data: body });
            })
            .catch(() => {
                if (active) setResult({ query, snapshot, error: 'Could not load the dashboard details. Please retry.' });
            })
            .finally(() => clearTimeout(timeout));
        return () => { active = false; clearTimeout(timeout); controller.abort(); };
    }, [query, snapshot, attempt]);
    return {
        ...(result?.query === query && result.snapshot === snapshot ? result : undefined),
        retry: () => { setResult(undefined); setAttempt(count => count + 1); },
    };
}

export function StockBreakdownPanel({ metric, data, office }: { metric: StockMetric; data: Snapshot; office: boolean }) {
    const { t } = useInventoryLanguage();
    const [period, setPeriod] = useState('all');
    const report = useDashboardReport<StockBreakdown>(new URLSearchParams({ metric, period, view: office ? 'office' : 'workshop' }).toString(), data);
    const stock = report.data;
    const stages = stockMetrics[metric].stages;
    const added = stock?.movements.reduce((total, row) => total + row.added, 0) ?? 0;
    const removed = stock?.movements.reduce((total, row) => total + row.removed, 0) ?? 0;
    const name = (profiles: Snapshot['companies'], id: string) => profiles.find(profile => profile.id === id)?.name || id;
    return <section id="home-stock-breakdown">
        <h2>{t(stockMetrics[metric].label)}</h2>
        <label className="prod-breakdown-period">{t('Movement period')}<select value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="all">{t('Since stock records began')}</option>
            <option value="recent">{t('Last 30 days')}</option>
        </select></label>
        {report.error ? <p role="alert">{t(report.error)} <button onClick={report.retry}>{t('Retry')}</button></p>
            : !stock ? <p role="status">{t('Loading…')}</p> : <>
                {stock.from && <p>{stock.from} – {stock.asOf}</p>}
                <dl className="prod-stock-equation">
                    {([['Opening stock', stock.opening], ['Added', added], ['Removed', removed], ['Current stock', stock.current]] as const).map(([label, quantity]) =>
                        <div key={label}><dt>{t(label)}</dt><dd>{number(quantity)} {t('pcs')}</dd></div>)}
                </dl>
                {stock.movements.length > 0 && <div className="prod-report-table"><table>
                    <thead><tr><th>{t('Movement')}</th><th>{t('Added')}</th><th>{t('Removed')}</th></tr></thead>
                    <tbody>{stock.movements.map(row => <tr key={row.kind}>
                        <td>{t(actions[row.kind]?.label || movementNames[row.kind] || row.kind)}</td>
                        <td>{number(row.added)}</td><td>{number(row.removed)}</td>
                    </tr>)}</tbody>
                </table></div>}
                <p className="prod-stock-stages">{stages.filter(stage => !office || stage === 'office_stock').map(stage => {
                    const quantity = stock.balances.filter(row => row.stage === stage).reduce((sum, row) => sum + row.quantity, 0);
                    return <span key={stage}>{t(labels[stage])} <b>{number(quantity)} {t('pcs')}</b></span>;
                })}</p>
                {stock.balances.length ? <details><summary>{t('Company and category breakdown')}</summary>
                    <div className="prod-report-table"><table>
                        <thead><tr>{['Company', 'Product Category', 'Stock location', 'Artist', 'Quantity (pcs)'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead>
                        <tbody>{stock.balances.map((row, index) => <tr key={index}>
                            <td>{name(data.companies, row.company)}</td><td>{name(data.products, row.product)}</td>
                            <td>{t(labels[row.stage])}{row.pool === 'company_return' && ' · ' + t('Company Return')}</td>
                            <td>{row.artisan ? name(data.artisans, row.artisan) : '—'}</td><td>{number(row.quantity)}</td>
                        </tr>)}</tbody>
                    </table></div>
                </details> : <p>{t('No stock in this section.')}</p>}
            </>}
    </section>;
}

function ReportCell({ label, children }: { label: string; children: ReactNode }) {
    return <td role="cell"><small className="prod-mobile-cell-label" aria-hidden="true">{label}</small><div>{children}</div></td>;
}

const performanceTabs = { artists: 'Artist Performance', raw: 'Raw / White Production Time', payments: 'Company Payment Performance' };
type PerformanceTab = keyof typeof performanceTabs;

export function PerformancePanel({ data, search, companyStatement }: {
    data: Snapshot;
    search: string;
    companyStatement: (company: string) => void;
}) {
    const { t } = useInventoryLanguage();
    const [tab, setTab] = useState<PerformanceTab>('artists');
    const report = useDashboardReport<PerformanceData>('mode=performance', data);
    const names = (profiles: Snapshot['companies']) => new Map(profiles.map(profile => [profile.id, profile.name]));
    const companies = names(data.companies);
    const products = names(data.products);
    const artists = names(data.artisans);
    const matches = (...parts: (string | undefined)[]) => parts.join(' ').toLowerCase().includes(search.trim().toLowerCase());
    const result = report.data;
    const aged = result?.stock.filter(row => (tab === 'raw' ? row.stage === 'raw' : row.stage !== 'raw')
        && matches(companies.get(row.company), products.get(row.product), artists.get(row.artisan), row.work)) ?? [];
    const payments = result?.companies.filter(row => matches(companies.get(row.company))).sort((a, b) =>
        (b.oldestUnpaidDays ?? -1) - (a.oldestUnpaidDays ?? -1) || (b.averageDays ?? -1) - (a.averageDays ?? -1)) ?? [];
    const ratings = tab === 'raw' ? rawRatings : artistRatings;
    const days = (value: number | null) => value === null ? '—' : number(value) + ' ' + t('days');
    return <section className="prod-performance">
        <div className="prod-actions" aria-label={t('Performance')}>
            {(Object.entries(performanceTabs) as [PerformanceTab, string][]).map(([id, label]) =>
                <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{t(label)}</button>)}
        </div>
        <h2>{t(performanceTabs[tab])}</h2>
        {report.error && <p role="alert">{t(report.error)} <button onClick={report.retry}>{t('Retry')}</button></p>}
        {!result && !report.error && <p role="status">{t('Loading…')}</p>}
        {result && (tab === 'payments' ? <>
            <p>{t('Payment speed is estimated from bill date to payment date, applying payments to the oldest open amounts first. Fast is up to 15 days, usual is 16–30 days, and slow is over 30 days.')}</p>
            {payments.length ? <div className="prod-report-table prod-performance-table"><table role="table">
                <thead role="rowgroup"><tr role="row">{['Company', 'Total payments received', 'Due / Advance', 'Last payment', 'Average payment time', 'Oldest unpaid bill', 'Statement / PDF'].map(label => <th key={label} scope="col" role="columnheader">{t(label)}</th>)}</tr></thead>
                <tbody role="rowgroup">{payments.map(row => {
                    const average = row.averageDays === null ? null : Math.round(row.averageDays);
                    const speed = average === null ? 'No matched payments' : average <= 15 ? 'Fast' : average <= 30 ? 'Usual' : 'Slow';
                    return <tr role="row" key={row.company}>
                        <ReportCell label={t('Company')}><strong>{companies.get(row.company) || row.company}</strong></ReportCell>
                        <ReportCell label={t('Total payments received')}>{rupees(row.paid)}</ReportCell>
                        <ReportCell label={t('Due / Advance')}>{rupees(Math.abs(row.balance))}{row.balance !== 0 && ' · ' + t(row.balance < 0 ? 'Advance' : 'Due')}</ReportCell>
                        <ReportCell label={t('Last payment')}>{row.lastPaid || '—'}</ReportCell>
                        <ReportCell label={t('Average payment time')}>{average !== null && days(average) + ' · '}{t(speed)}</ReportCell>
                        <ReportCell label={t('Oldest unpaid bill')}>{row.oldestUnpaidDays !== null && row.oldestUnpaidDays > 30
                            ? <span className="prod-age-band band-3">{days(row.oldestUnpaidDays)}</span> : days(row.oldestUnpaidDays)}</ReportCell>
                        <ReportCell label=""><button onClick={() => companyStatement(row.company)}>{t('Statement / PDF')}</button></ReportCell>
                    </tr>;
                })}</tbody>
            </table></div> : <p>{t('No company payments or bills to show.')}</p>}
        </> : <>
            <p>{t('Stock age uses the entered movement date. For pooled quantities, the oldest pieces are counted out first. Older stock without a recorded date is shown as unknown.')}</p>
            <ul className="prod-performance-legend">{ratings.map((rating, index) =>
                <li className={'prod-age-band band-' + index} key={rating}>{t(rating)} · {['0–10', '11–14', '15–19', '20+'][index]} {t('days')}</li>)}</ul>
            {aged.length ? <div className="prod-report-table prod-performance-table"><table role="table">
                <thead role="rowgroup"><tr role="row">{[...(tab === 'artists' ? ['Artist'] : []), 'Company', 'Product Category', 'Stock location', 'Quantity (pcs)', 'Since', 'Age', 'Rating'].map(label => <th key={label} scope="col" role="columnheader">{t(label)}</th>)}</tr></thead>
                <tbody role="rowgroup">{aged.map((row, index) => {
                    const age = row.date ? daysBetween(row.date, result.asOf) : null;
                    return <tr role="row" key={index}>
                        {tab === 'artists' && <ReportCell label={t('Artist')}><strong>{artists.get(row.artisan) || row.artisan}</strong></ReportCell>}
                        <ReportCell label={t('Company')}>{companies.get(row.company) || row.company}</ReportCell>
                        <ReportCell label={t('Product Category')}>{products.get(row.product) || row.product}</ReportCell>
                        <ReportCell label={t('Stock location')}>{t(labels[row.stage])}{row.work && ' · ' + row.work}{row.pool === 'company_return' && ' · ' + t('Company Return')}</ReportCell>
                        <ReportCell label={t('Quantity (pcs)')}>{number(row.quantity)}</ReportCell>
                        <ReportCell label={t('Since')}>{row.date || '—'}</ReportCell>
                        <ReportCell label={t('Age')}>{days(age)}</ReportCell>
                        <ReportCell label={t('Rating')}>{age === null ? t('Unknown') : <span className={'prod-age-band band-' + stockAgeBand(age)}>{t(ratings[stockAgeBand(age)])}</span>}</ReportCell>
                    </tr>;
                })}</tbody>
            </table></div> : <p>{t('No stock in this section.')}</p>}
        </>)}
    </section>;
}
