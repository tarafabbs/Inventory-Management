import { db } from './database';
import { blankLayout, type ReturnOption, type SaleDocument, type SalesHub, type SalesLedgerRow } from './direct-sales';

export async function salesHub(): Promise<SalesHub> {
    const row = await db.prepare(`
        WITH totals AS (
            SELECT customer,sum(amount)::float8 AS due FROM (
                SELECT customer,total-paid+coalesce((body->>'bookingAdvance')::bigint,0) AS amount
                FROM inventory.sales_documents WHERE voided_at IS NULL AND kind<>'booking'
                UNION ALL SELECT customer,-paid FROM inventory.sales_documents WHERE kind='booking' AND paid<>0
                UNION ALL SELECT customer,amount FROM inventory.sales_customer_money
            ) m GROUP BY customer
        )
        SELECT coalesce((SELECT jsonb_agg(c ORDER BY c.name) FROM inventory.sales_customers c),'[]') AS customers,
               coalesce((SELECT jsonb_agg(p ORDER BY p.name) FROM inventory.sales_products p),'[]') AS products,
               coalesce((SELECT jsonb_agg(to_jsonb(d)-'body'-'stock_delta' ORDER BY d.date DESC,d.created_at DESC)
                         FROM inventory.sales_documents d),'[]') AS documents,
               (SELECT body FROM inventory.sales_layout WHERE singleton) AS layout,
               coalesce((SELECT jsonb_agg(t) FROM totals t),'[]') AS balances,
               (SELECT count(*)::int FROM inventory.sales_documents b WHERE b.kind='booking' AND b.voided_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM inventory.sales_documents s WHERE s.booking_id=b.id AND s.voided_at IS NULL)) AS bookings
    `).first<SalesHub>(15_000);
    if (!row) throw Error('Could not load Direct Sell.');
    return { ...row, layout: {...blankLayout,...row.layout} };
}

export async function bookingCount() {
    const row = await db.prepare(`
        SELECT count(*)::int AS count FROM inventory.sales_documents b WHERE b.kind='booking' AND b.voided_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM inventory.sales_documents s WHERE s.booking_id=b.id AND s.voided_at IS NULL)
    `).first<{count:number}>(12_000);
    return row?.count ?? 0;
}

export async function salesDocument(id: string) {
    return db.prepare(`
       SELECT d.id,d.kind,d.gst,d.fiscal_year,d.number,d.date::text,d.customer,d.booking_id,d.revision,d.body,
            d.total::float8,d.paid::float8,d.voided_at,
            (SELECT actor FROM inventory.sales_document_revisions r WHERE r.document=d.id AND r.revision=d.revision) AS actor
       FROM inventory.sales_documents d WHERE d.id=?
    `).bind(id).first<SaleDocument>(12_000);
}

export async function customerReturns(customer: string, editing: string) {
    const row = await db.prepare(`
        WITH already_returned AS (
            SELECT l->>'returnFrom' AS id, sum((l->>'quantity')::int) AS qty
            FROM inventory.sales_documents d CROSS JOIN LATERAL jsonb_array_elements(d.body->'lines') l
            WHERE d.customer=? AND d.voided_at IS NULL AND d.kind<>'booking' AND d.id<>?
              AND l->>'type'='return' AND l->>'returnFrom'<>''
            GROUP BY 1
        ), available AS (
            SELECT line->>'id' AS id,d.number,line,d.gst,
                   d.body->>'taxMode' AS "taxMode",(d.body->>'cgstRate')::int AS "cgstRate",
                   (d.body->>'sgstRate')::int AS "sgstRate",(d.body->>'igstRate')::int AS "igstRate",
                   d.body->>'place' AS place,
                   ((line->>'quantity')::int-coalesce(r.qty,0))::int AS remaining,d.date,d.number AS series
            FROM inventory.sales_documents d CROSS JOIN LATERAL jsonb_array_elements(d.body->'lines') line
            LEFT JOIN already_returned r ON r.id=line->>'id'
            WHERE d.customer=? AND d.voided_at IS NULL AND d.kind='bill' AND d.id<>?
              AND line->>'type'='sale' AND (line->>'quantity')::int>coalesce(r.qty,0)
        )
        SELECT coalesce(jsonb_agg(a ORDER BY a.date DESC,a.series DESC),'[]') AS items FROM available a
    `).bind(customer,editing,customer,editing).first<{items:ReturnOption[]}>(12_000);
    return row?.items ?? [];
}

export async function salesStatement(customer: string) {
    const row = await db.prepare(`
        WITH documents AS (
            SELECT d.id,d.customer,d.date,d.number,d.kind,d.created_at,d.total,d.paid,d.body,d.voided_at
            FROM inventory.sales_documents d
            WHERE (d.voided_at IS NULL OR d.kind='booking' AND d.paid<>0) AND (?='' OR d.customer=?)
        ), rows AS (
            SELECT id,customer,date,number AS label,total AS amount,created_at,0 AS position FROM documents WHERE kind<>'booking' AND total<>0
            UNION ALL
            SELECT id,customer,date,CASE WHEN kind='booking' THEN 'Booking advance · '
                         WHEN paid<0 THEN 'Refund · ' ELSE 'Paid · ' END||number,
                   CASE WHEN kind='booking' THEN -paid ELSE -(paid-coalesce((body->>'bookingAdvance')::bigint,0)) END,
                   created_at,1 FROM documents WHERE paid<>0
            UNION ALL
            SELECT id,customer,date,kind||CASE WHEN method='' THEN '' ELSE ' · '||method END,amount,created_at,-1
            FROM inventory.sales_customer_money WHERE (?='' OR customer=?)
        )
        SELECT coalesce(jsonb_agg(r ORDER BY r.date,r.created_at,r.id,r.position),'[]') AS rows
        FROM (SELECT * FROM rows LIMIT 20001) r
    `).bind(customer,customer,customer,customer).first<{rows:SalesLedgerRow[]}>(15_000);
    if (!row || row.rows.length>20000) throw Error('Choose an individual customer to generate this statement.');
    return row.rows;
}

export type JobAdvance = { id:string; company:string; date:string; amount:number; notes:string; actor:string };
export async function jobAdvances(company: string) {
    return (await db.prepare(`
        SELECT a.id,a.company,a.date::text,a.amount::float8,a.notes,a.actor FROM inventory.sales_job_advances a
        JOIN companies c ON c.id=a.company WHERE a.company=? AND c.ownership='EXTERNAL' AND c.office_only=0
        ORDER BY a.date DESC,a.created_at DESC
    `).bind(company).all<JobAdvance>()).results;
}

export type StoredSale = SaleDocument & {stock_delta:import('./production').Delta[]; updated_at:Date};
