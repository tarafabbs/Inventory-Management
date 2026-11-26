import {db} from './database';
import type {StatementFilter,StatementSource} from './statements';
export async function statementSource(filter:StatementFilter):Promise<StatementSource>{
 const row=await db.prepare(`WITH p AS (SELECT ?::text AS scope,?::text AS id,nullif(?,'')::date AS first_date,?::date AS last_date),
 later AS (
  SELECT d->>'company' AS company,d->>'product' AS product,d->>'pool' AS pool,d->>'stage' AS stage,coalesce(d->>'artisan','') AS artisan,coalesce(d->>'arts','') AS arts,coalesce(d->>'work','') AS work,sum((d->>'quantity')::bigint) AS quantity
  FROM inventory.production_events e CROSS JOIN p CROSS JOIN LATERAL jsonb_array_elements(e.delta) d WHERE e.event_date>p.last_date GROUP BY 1,2,3,4,5,6,7
 ), stock AS (
  SELECT b.company,b.product,b.pool,b.stage,b.artisan,b.arts,b.work,(b.quantity-coalesce(l.quantity,0))::float8 AS quantity
  FROM inventory.production_balances b JOIN companies c ON c.id=b.company CROSS JOIN p LEFT JOIN later l ON (l.company,l.product,l.pool,l.stage,l.artisan,l.arts,l.work)=(b.company,b.product,b.pool,b.stage,b.artisan,b.arts,b.work)
  WHERE c.office_only=0 AND (p.scope='overall' OR p.scope='company' AND b.company=p.id OR p.scope='artisan' AND b.artisan=p.id)
 ), cm AS (
  SELECT e.id::text AS id,m.company AS party,e.event_date::text AS date,e.created_at,e.kind,coalesce(e.payload->>'correctionKind',linked.payload->>'correctionKind',linked.kind,e.kind) AS base_kind,sum(m.amount)::float8 AS amount,e.reference,e.notes,e.actor
  FROM inventory.production_money m JOIN inventory.production_events e ON e.id=m.event_id JOIN companies c ON c.id=m.company CROSS JOIN p LEFT JOIN inventory.production_events linked ON linked.id::text=e.payload->>'document'
  WHERE c.office_only=0 AND p.scope<>'artisan' AND (p.scope<>'company' OR m.company=p.id) AND e.event_date<=p.last_date GROUP BY e.id,m.company,linked.kind,linked.payload
 ), am AS (
  SELECT min(m.id::text) AS id,m.artisan AS party,min(m.entry_date)::text AS date,min(m.created_at) AS created_at,coalesce(e.kind,max(m.kind)) AS kind,CASE WHEN m.event_id IS NOT NULL THEN 'charge' ELSE coalesce(max(original.kind),max(m.kind)) END AS base_kind,sum(m.amount)::float8 AS amount,max(m.reference) AS reference,max(m.notes) AS notes,max(m.actor) AS actor,m.event_id::text AS event_id,bool_or(EXISTS(SELECT 1 FROM inventory.artisan_money r WHERE r.reversal_of=m.id AND r.entry_date<=p.last_date)) AS reversed
  FROM inventory.artisan_money m CROSS JOIN p LEFT JOIN inventory.production_events e ON e.id=m.event_id LEFT JOIN inventory.artisan_money original ON original.id=m.reversal_of
  WHERE p.scope<>'company' AND (p.scope<>'artisan' OR m.artisan=p.id) AND m.entry_date<=p.last_date GROUP BY coalesce(m.event_id,m.id),m.event_id,m.artisan,e.kind
 ), future_settlements AS (
  SELECT e.payload->>'document' AS id,CASE WHEN e.kind='settle' THEN (e.payload->>'reason')::int ELSE coalesce((SELECT sum((l->>'quantity')::int) FROM jsonb_array_elements(e.payload->'lines') l),0) END AS quantity
  FROM inventory.production_events e CROSS JOIN p WHERE e.event_date>p.last_date AND e.kind IN ('settle','replacement','order_receive')
  UNION ALL
  SELECT d.payload->>'document',coalesce((SELECT sum((l->>'quantity')::int) FROM jsonb_array_elements(e.payload->'lines') l),0)
  FROM inventory.production_events e JOIN inventory.production_documents d ON d.id::text=e.payload->>'document' CROSS JOIN p WHERE e.event_date>p.last_date AND e.kind='order_receive'
 ), docs AS (
  SELECT d.id,d.kind,d.company,d.quantity,(d.settled-coalesce((SELECT sum(f.quantity) FROM future_settlements f WHERE f.id=d.id::text),0))::float8 AS settled,d.amount::float8 AS amount,d.payload,d.created_at,(EXISTS(SELECT 1 FROM inventory.production_events r WHERE r.kind='reset' AND r.event_date<=p.last_date AND jsonb_exists(r.payload->'resetDocuments',d.id::text) AND NOT EXISTS(SELECT 1 FROM inventory.production_events u WHERE u.kind='undo_reset' AND u.event_date<=p.last_date AND u.payload->>'document'=r.id::text))) AS voided
  FROM inventory.production_documents d CROSS JOIN p WHERE (d.payload->>'date')::date<=p.last_date AND (p.scope='overall' OR p.scope='company' AND d.company=p.id OR p.scope='artisan' AND d.payload->>'identifiedArtist'=p.id)

 ), activity AS (
  SELECT e.* FROM inventory.production_events e CROSS JOIN p WHERE e.event_date<=p.last_date AND (p.first_date IS NULL OR e.event_date>=p.first_date) AND e.kind<>'migration'
  AND (p.scope='overall' OR p.scope='company' AND (e.company=p.id OR e.delta @> jsonb_build_array(jsonb_build_object('company',p.id))) OR p.scope='artisan' AND e.delta @> jsonb_build_array(jsonb_build_object('artisan',p.id))) ORDER BY e.event_date,e.created_at,e.id LIMIT 20001
 ) SELECT
 coalesce((SELECT min(event_date)::text FROM inventory.production_events WHERE kind='migration'),'') AS "cutoverDate",
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'contact',c.contact,'address',c.address,'active',c.active,'ownership',c.ownership) ORDER BY c.name) FROM companies c WHERE c.office_only=0),'[]') AS companies,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'contact',a.contact,'active',a.active) ORDER BY a.name) FROM artisans a),'[]') AS artisans,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'active',r.active) ORDER BY r.name) FROM products r WHERE r.office_only=0),'[]') AS products,
 coalesce((SELECT jsonb_agg(s ORDER BY s.company,s.product,s.pool,s.stage,s.artisan) FROM stock s WHERE s.quantity<>0),'[]') AS balances,
 coalesce((SELECT jsonb_agg(d ORDER BY d.created_at,d.id) FROM docs d),'[]') AS documents,
 coalesce((SELECT jsonb_agg(e ORDER BY e.event_date,e.created_at,e.id) FROM activity e),'[]') AS events,
 coalesce((SELECT jsonb_agg(r ORDER BY r.date,r.created_at,r.id) FROM (SELECT cm.* FROM cm,p WHERE p.first_date IS NULL OR cm.date::date>=p.first_date ORDER BY cm.date,cm.created_at,cm.id LIMIT 20001) r),'[]') AS "companyMoney",
 coalesce((SELECT jsonb_agg(r ORDER BY r.date,r.created_at,r.id) FROM (SELECT am.* FROM am,p WHERE p.first_date IS NULL OR am.date::date>=p.first_date ORDER BY am.date,am.created_at,am.id LIMIT 20001) r),'[]') AS "artisanMoney",
 coalesce((SELECT jsonb_agg(r) FROM (SELECT party,sum(amount)::float8 AS amount FROM cm,p WHERE cm.date::date<p.first_date GROUP BY party) r),'[]') AS "companyOpening",
 coalesce((SELECT jsonb_agg(r) FROM (SELECT party,sum(amount)::float8 AS amount FROM am,p WHERE am.date::date<p.first_date GROUP BY party) r),'[]') AS "artisanOpening",
 coalesce((SELECT jsonb_agg(r) FROM (SELECT party,sum(amount)::float8 AS amount FROM cm GROUP BY party) r),'[]') AS "companyTotals",
 coalesce((SELECT jsonb_agg(r) FROM (SELECT party,sum(amount)::float8 AS amount FROM am GROUP BY party) r),'[]') AS "artisanTotals"
 `).bind(filter.scope,filter.id,filter.from,filter.to).first<StatementSource>(20_000);
 if(!row)throw Error('Could not load the statement.');return row;
}
