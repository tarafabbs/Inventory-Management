import {db} from './database';
import type {InventoryUser} from './inventory-identity';
import type {Snapshot} from './production-types';

// One query avoids concurrent unnamed prepared statements through the pooler and
// provides a consistent snapshot without eight independent connection round trips.
export async function productionSnapshot(user:Pick<InventoryUser,'id'|'name'|'role'>, {company='',page=0,office=false}:{company?:string;page?:number;office?:boolean}={}):Promise<Snapshot>{
 const officeScope=office?"AND b.stage IN ('office_pending','office_stock','office_sold','office_return') AND (c.ownership='OWN' OR c.office_only=1)":'';
 const officeEvents=office?"AND (e.kind IN ('office_send','office_receive','office_sell','office_return','office_vendor','vendor_return') OR e.kind='correct' AND e.payload->>'correctionKind'='office_vendor')":'';
 const row=await db.prepare(`WITH stock AS (
   SELECT b.* FROM inventory.production_balances b JOIN companies c ON c.id=b.company WHERE b.quantity>0 ${officeScope}
 ), history AS (
   SELECT e.id,e.kind,e.event_date,e.reference,e.notes,e.actor,e.actor_id,e.actor_role,e.created_at,e.payload,e.delta
   FROM inventory.production_events e WHERE (?='' OR e.company=? OR e.delta @> ?::text::jsonb) ${officeEvents}
   ORDER BY e.created_at DESC,e.id DESC LIMIT 51 OFFSET ?
 ) SELECT
 coalesce((SELECT jsonb_agg(s ORDER BY s.company,s.product,s.stage) FROM stock s),'[]') AS balances,
 coalesce((SELECT jsonb_agg(h ORDER BY h.created_at DESC,h.id DESC) FROM history h),'[]') AS history,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'active',c.active,'profile_status',c.profile_status,'ownership',c.ownership,'office_only',c.office_only,'contact',c.contact,'address',c.address,'notes',c.notes) ORDER BY c.name)
   FROM companies c ${office?"WHERE c.ownership='OWN' OR c.office_only=1":''}),'[]') AS companies,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'active',p.active,'office_only',p.office_only) ORDER BY p.name)
   FROM products p ${office?"WHERE p.office_only=1 OR p.id IN (SELECT product FROM stock)":''}),'[]') AS products,
 ${office?"'[]'::jsonb":"coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'active',a.active,'profile_status',a.profile_status,'work_type',a.work_type,'work_description',a.work_description,'work_types',a.work_types,'contact',a.contact,'address',a.address) ORDER BY a.name) FROM artisans a),'[]')"} AS artisans,
 ${office?"'[]'::jsonb":"coalesce((SELECT jsonb_agg(m) FROM (SELECT company,sum(amount)::float8 AS due FROM inventory.production_money GROUP BY company) m),'[]')"} AS money,
 ${office?"'[]'::jsonb":"coalesce((SELECT jsonb_agg(d ORDER BY d.created_at DESC) FROM inventory.production_documents d WHERE d.voided_at IS NULL),'[]')"} AS documents,
 coalesce((SELECT value FROM settings WHERE key='production_opening_date'),'') AS "openingDate"
 `).bind(company,company,JSON.stringify([{company}]),page*50).first<Omit<Snapshot,'user'|'more'>>(12_000);
 if(!row)throw new Error('Stock could not be loaded. Please retry.');
 return {...row,user:{id:user.id,name:user.name,role:user.role},more:row.history.length>50,history:row.history.slice(0,50)};
}
