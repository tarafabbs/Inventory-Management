import { db } from '@/lib/database';
import { inventorySession } from '@/lib/inventory-identity';
import { companyPaymentPerformance, stockMetrics, type AgedStock, type CompanyPayment, type StockBreakdown, type StockMetric } from '@/lib/production-dashboard';
import { isManagement, isOfficeRole, permitted } from '@/lib/rules';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
    try {
        const { signedIn, staff } = await inventorySession();
        if (!signedIn || !staff || !permitted(staff.role, 'read')) return reply({ error: 'Access denied.' }, 403);
        const q = new URL(request.url).searchParams;
        const office = isOfficeRole(staff.role) || (isManagement(staff.role) && q.get('view') === 'office');
        if (q.get('mode') === 'performance') {
            if (office) return reply({ error: 'Workshop access required.' }, 403);
            return reply(await performance());
        }
        const metric = q.get('metric') || '';
        if (!Object.hasOwn(stockMetrics, metric)) return reply({ error: 'Choose a stock total.' }, 400);
        return reply(await breakdown(metric as StockMetric, office, q.get('period') === 'recent'));
    } catch (error) {
        console.error('Production dashboard:', error instanceof Error ? error.message : 'Unknown error');
        return reply({ error: 'Could not load the dashboard details. Please retry.' }, 503);
    }
}

async function breakdown(metric: StockMetric, office: boolean, recent: boolean): Promise<StockBreakdown> {
    const stages = stockMetrics[metric].stages.filter(stage => !office || stage === 'office_stock');
    const officeScope = office ? "AND (c.ownership='OWN' OR c.office_only=1)" : '';
    const row = await db.prepare(`
        WITH dates AS (
            SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today
        ), stock AS (
            SELECT b.* FROM inventory.production_balances b JOIN companies c ON c.id=b.company
            WHERE b.quantity>0 AND b.stage=ANY(?::text[]) ${officeScope}
        ), event_changes AS (
            SELECT e.id, e.kind,
                   sum((line->>'quantity')::bigint) AS net
            FROM inventory.production_events e CROSS JOIN dates
            CROSS JOIN LATERAL jsonb_array_elements(e.delta) line
            JOIN companies c ON c.id=line->>'company'
            WHERE e.event_date<=dates.today AND (NOT ?::boolean OR e.event_date>=dates.today-29)
              AND line->>'stage'=ANY(?::text[]) ${officeScope}
            GROUP BY e.id,e.kind
        ), movements AS (
            SELECT kind, sum(greatest(net,0))::float8 AS added,
                   sum(greatest(-net,0))::float8 AS removed
            FROM event_changes WHERE net<>0 GROUP BY kind
        )
        SELECT CASE WHEN ?::boolean THEN (today-29)::text ELSE '' END AS "from",today::text AS "asOf",
               coalesce((SELECT sum(quantity)::float8 FROM stock),0) AS current,
               coalesce((SELECT sum(quantity)::float8 FROM stock),0) -
               coalesce((SELECT sum(added-removed) FROM movements),0) AS opening,
               coalesce((SELECT jsonb_agg(m ORDER BY kind) FROM movements m),'[]') AS movements,
               coalesce((SELECT jsonb_agg(s ORDER BY company,product,stage,artisan) FROM stock s),'[]') AS balances
        FROM dates
    `).bind('{' + stages.join(',') + '}', recent, '{' + stages.join(',') + '}', recent).first<StockBreakdown>(12_000);
    if (!row) throw Error('Stock breakdown unavailable');
    return row;
}

async function performance() {
    const row = await db.prepare(`
        WITH balances AS (
            SELECT b.* FROM inventory.production_balances b JOIN companies c ON c.id=b.company
            WHERE c.office_only=0 AND b.quantity>0 AND b.stage IN ('raw','artist','reprint')
        ), last_reset AS (
            SELECT max(r.created_at) AS at FROM inventory.production_events r
            WHERE r.kind='reset' AND NOT EXISTS (
                SELECT 1 FROM inventory.production_events u
                WHERE u.kind='undo_reset' AND u.payload->>'document'=r.id::text
            )
        ), credits AS (
            SELECT b.key,e.id,e.event_date,coalesce((e.payload->>'originalCreatedAt')::timestamptz,e.created_at) AS posted_at,
                   sum((d->>'quantity')::bigint) AS added
            FROM inventory.production_effective_events e CROSS JOIN last_reset
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN e.kind='correct' THEN coalesce(e.payload->'effectiveDelta',e.delta) ELSE e.delta END
            ) d
            JOIN balances b ON (b.company,b.product,b.pool,b.stage,b.artisan,b.arts,b.work)=
                (d->>'company',d->>'product',d->>'pool',d->>'stage',d->>'artisan',d->>'arts',d->>'work')
            WHERE e.kind NOT IN ('reset','undo_reset') AND e.created_at>coalesce(last_reset.at,'-infinity'::timestamptz)
            GROUP BY b.key,e.id,e.event_date,e.created_at,e.payload
            HAVING sum((d->>'quantity')::bigint)>0
        ), newest AS (
            SELECT *, coalesce(sum(added) OVER (
                PARTITION BY key ORDER BY posted_at DESC,id DESC
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),0) AS later FROM credits
        ), dated AS (
            SELECT b.key,n.event_date::text AS date,sum(least(n.added,b.quantity-n.later))::int AS quantity
            FROM balances b JOIN newest n ON n.key=b.key AND n.later<b.quantity
            GROUP BY b.key,n.event_date
        ), dated_totals AS (
            SELECT key,sum(quantity)::int AS quantity FROM dated GROUP BY key
        ), aged AS (
            SELECT b.company,b.product,b.pool,b.stage,b.artisan,b.arts,b.work,d.date,d.quantity
            FROM balances b JOIN dated d ON d.key=b.key
            UNION ALL
            SELECT b.company,b.product,b.pool,b.stage,b.artisan,b.arts,b.work,NULL,b.quantity-coalesce(d.quantity,0)
            FROM balances b LEFT JOIN dated_totals d ON d.key=b.key
            WHERE b.quantity>coalesce(d.quantity,0)
        ), money_rows AS (
            SELECT m.company,e.event_date::text AS date,e.created_at,e.id,m.kind,m.amount
            FROM inventory.production_effective_events e
            JOIN inventory.production_money m ON m.event_id=e.id
            JOIN companies c ON c.id=m.company
            WHERE e.kind<>'correct' AND c.ownership='EXTERNAL' AND c.office_only=0
            UNION ALL
            SELECT m->>'company',e.event_date::text,e.created_at,e.id,m->>'kind',(m->>'amount')::bigint
            FROM inventory.production_effective_events e
            CROSS JOIN LATERAL jsonb_array_elements(coalesce(e.payload->'effectiveMoney','[]')) m
            JOIN companies c ON c.id=m->>'company'
            WHERE e.kind='correct' AND c.ownership='EXTERNAL' AND c.office_only=0
        ) SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS "asOf",
            coalesce((SELECT jsonb_agg(a ORDER BY a.date ASC NULLS LAST,a.company,a.product,a.artisan)
                FROM (SELECT * FROM aged LIMIT 20001) a),'[]') AS stock,
            coalesce((SELECT jsonb_agg(jsonb_build_object('company',m.company,'date',m.date,'kind',m.kind,'amount',m.amount)
                ORDER BY m.date,m.created_at,m.id) FROM (SELECT * FROM money_rows LIMIT 20001) m),'[]') AS payments
    `).first<{ asOf: string; stock: AgedStock[]; payments: CompanyPayment[] }>(15_000);
    if (!row || row.stock.length > 20000 || row.payments.length > 20000) throw Error('Performance report unavailable or exceeds row limit');
    return { asOf: row.asOf, stock: row.stock, companies: companyPaymentPerformance(row.payments, row.asOf) };
}
