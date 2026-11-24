import { db } from '@/lib/database';
import { inventorySession } from '@/lib/inventory-identity';
import { isOfficeRole, permitted } from '@/lib/rules';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    try {
        const { staff, signedIn } = await inventorySession();
        if (!staff || !signedIn || !permitted(staff.role, 'read'))
            return Response.json({ error: 'Access denied.' }, { status: 403 });
        const q = new URL(request.url).searchParams, company = q.get('company') || '', date = q.get('date') || '', search = (q.get('search') || '').slice(0, 200), kind = q.get('kind') || '', artisan = q.get('artisan') || '';
        const page = Number(q.get('page') || 0);
        if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
            throw Error('Invalid page.');
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
            throw Error('Invalid date.');
        const office = isOfficeRole(staff.role);
        const scope = office ? "AND e.kind IN ('office_send','office_receive','office_sell','office_return','office_vendor','vendor_return')" : '';
        if (q.get('mode') === 'reports') {
            if (office)
                return Response.json({ error: 'Workshop reports require workshop access.' }, { status: 403 });
            const result = await db.prepare(`WITH entries AS (
    SELECT e.*,CASE WHEN e.effective_kind='dispatch' THEN coalesce((SELECT sum((d->>'quantity')::int) FROM jsonb_array_elements(e.delta) d WHERE d->>'stage'='delivered' AND (d->>'quantity')::int>0),0) ELSE coalesce((SELECT sum((l->>'quantity')::int) FROM jsonb_array_elements(coalesce(e.payload->'lines','[]')) l),0) END AS qty
    FROM inventory.production_effective_events e WHERE (?='' OR company=?)
   ), grouped AS (SELECT effective_kind AS kind,count(*)::int AS entries,sum(qty)::float8 AS quantity FROM entries GROUP BY effective_kind),
   days AS (SELECT event_date::text AS date,sum(CASE WHEN effective_kind='dispatch' THEN qty ELSE 0 END)::float8 AS dispatched,
    sum(CASE WHEN effective_kind='payment' THEN coalesce((payload->>'amount')::numeric,0) ELSE 0 END)::float8 AS paid FROM entries GROUP BY event_date),
   payments AS (SELECT event_date,event_date-lag(event_date) OVER(ORDER BY event_date,created_at) AS gap FROM entries WHERE effective_kind='payment')
   SELECT coalesce((SELECT jsonb_agg(g) FROM grouped g),'[]') AS actions,coalesce((SELECT jsonb_agg(d ORDER BY d.date) FROM days d),'[]') AS days,
   (SELECT count(*)::int FROM payments) AS payment_count,(SELECT round(avg(gap)::numeric,1)::float8 FROM payments) AS average_payment_gap
  `).bind(company, company).first();
            return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
        }
        const limit = q.get('export') === 'true' ? 10000 : 51;
        const result = await db.prepare(`SELECT e.*,EXISTS(SELECT 1 FROM inventory.production_events r WHERE r.kind IN ('correct','delete') AND r.payload->>'document'=e.id::text) AS reversed
 FROM inventory.production_events e WHERE (?='' OR e.company=?) AND (?='' OR e.event_date=?::date)
 AND (?='' OR e.kind=? OR (e.kind='correct' AND e.payload->>'correctionKind'=?))
 AND (?='' OR e.payload::text LIKE '%' || ? || '%')
 AND (?='' OR e.actor ILIKE ? OR e.notes ILIKE ? OR e.reference ILIKE ? OR e.payload::text ILIKE ?)
 ${scope} ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?`).bind(company, company, date, date || null, kind, kind, kind, artisan, artisan, search, '%' + search + '%', '%' + search + '%', '%' + search + '%', '%' + search + '%', limit, page * 50).all();
        return Response.json({ history: result.results.slice(0, limit === 51 ? 50 : limit), more: result.results.length === limit }, { headers: { 'Cache-Control': 'no-store' } });
    }
    catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Could not load history.' }, { status: 400 });
    }
}
