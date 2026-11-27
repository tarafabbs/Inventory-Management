import { randomUUID } from 'node:crypto';
import type { LedgerDatabase } from './database';
import type { InventoryUser } from './inventory-identity';
import { accountKey, type Account, type Delta } from './production';
import { isOwner, roleLabel } from './rules';
import {
    blankLayout, calculateSale, cents, dateValue, documentNumber, fiscalYear, gstNumber, netStock, rate, saleStages,
    seriesFor, units, type SalesCustomer, type SalesLayout, type SalesProduct, type SaleBody, type SaleKind,
    type SaleLine, type SaleInputLine, type SaleDocument,
} from './direct-sales';
import type { StoredSale } from './sales-read';

type Tx = Parameters<Parameters<LedgerDatabase['transaction']>[0]>[0];
type Fields = Record<string, unknown>;
type StockSource = Account & { key:string; name:string; active:number };
export const rejectSales = (message: string, status = 400) => Object.assign(Error(message), {status});

function value(input: unknown, max: number, label: string, required=false): string {
    const result = typeof input === 'string' ? input.trim() : '';
    if (result.length > max || (required && !result)) throw Error('Check ' + label + ' (maximum ' + max + ' characters).');
    return result;
}

function layoutValue(data: Fields): SalesLayout {
    const result = {...blankLayout};
    for (const field of ['seller','address','phone'] as const)
        result[field]=value(data[field],field==='seller'||field==='phone'?120:1200,field,field==='seller');
    result.gst=gstNumber(value(data.gst,15,'supplier GSTIN'));
    result.bankName=value(data.bankName,120,'bank name');
    result.accountNumber=value(data.accountNumber,25,'account number');
    result.ifsc=value(data.ifsc,11,'IFSC').toUpperCase();
    result.branch=value(data.branch,120,'branch');
    if ([result.bankName,result.accountNumber,result.ifsc,result.branch].some(Boolean)) {
        if (!result.bankName || !/^[0-9]{6,25}$/.test(result.accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(result.ifsc) || !result.branch)
            throw Error('Enter bank name, 6–25 digit account number, valid IFSC and detected branch.');
    }
    for (const field of ['logo','signature','qr'] as const) {
        const image=value(data[field],220_000,field);
        if(image && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw Error('Upload a PNG, JPEG or WebP image.');
        result[field]=image;
    }
    return result;
}

async function customerById(tx:Tx, id:string) {
    const customer=await tx.prepare('SELECT id,name,address,phone,gst FROM inventory.sales_customers WHERE id=?').bind(id).first<SalesCustomer>();
    if (!customer) throw Error('Choose a saved customer.');
    return customer;
}

const methods=['Cash','UPI','Bank transfer','Card','Other'];
function paymentMethod(input:unknown, paid:number) {
    if (!paid) return '';
    const method=String(input||'');
    if (!methods.includes(method)) throw Error('Choose how the payment was made.');
    return method;
}

async function recordAudit(tx:Tx,user:InventoryUser,action:string,label:string,data:Fields) {
    await tx.prepare('INSERT INTO inventory.change_audit(actor_id,actor,actor_role,action,target_label,after_data) VALUES(?,?,?,?,?,?::text::jsonb)')
        .bind(user.id,user.name,roleLabel(user.role),action,label,JSON.stringify(data)).run();
}

export async function salesMutation(tx:Tx,user:InventoryUser,v:Fields) {
    const id=randomUUID();
    switch(v.op) {
        case 'customer': {
            const name=value(v.name,120,'customer name',true);
            const address=value(v.address,800,'customer address'),phone=value(v.phone,50,'phone');
            const gst=gstNumber(value(v.gst,15,'customer GSTIN'));
            const target=typeof v.id==='string' && v.id ? (await customerById(tx,v.id)).id : id;
            await tx.prepare(`INSERT INTO inventory.sales_customers(id,name,address,phone,gst) VALUES(?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,phone=excluded.phone,gst=excluded.gst`)
                .bind(target,name,address,phone,gst).run();
            await recordAudit(tx,user,'direct_sales_customer',name,{id:target});
            return {id:target};
        }
        case 'product': {
            const name=value(v.name,120,'product name',true), price=cents(v.price,'Price');
            const hsn=value(v.hsn,8,'HSN'),sku=value(v.sku,80,'SKU');
            if(hsn && !/^\d{4,8}$/.test(hsn)) throw Error('Enter a 4–8 digit HSN or leave it empty.');
            const stockProduct=value(v.stockProduct,120,'stock product');
            if(stockProduct && !await tx.prepare('SELECT id FROM products WHERE id=? AND office_only=0').bind(stockProduct).first())
                throw Error('Choose a workshop product category.');
            const existing=await tx.prepare(`SELECT id FROM inventory.sales_products
                WHERE (?<>'' AND stock_product=?) OR (?='' AND stock_product IS NULL AND lower(name)=lower(?))`)
                .bind(stockProduct,stockProduct,stockProduct,name).first<{id:string}>();
            if(existing && !stockProduct) throw Error('A catalogue product already has this name.');
            const target=existing?.id||id;
            await tx.prepare(`INSERT INTO inventory.sales_products(id,name,price,hsn,sku,stock_product) VALUES(?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,hsn=excluded.hsn,sku=excluded.sku`)
                .bind(target,name,price,hsn,sku,stockProduct||null).run();
            await recordAudit(tx,user,'direct_sales_product',name,{id:target});
            return {id:target};
        }
        case 'layout': {
            if (!isOwner(user.role)) throw rejectSales('Only Owner can change the bill layout.',403);
            const body=layoutValue(v);
            await tx.prepare(`INSERT INTO inventory.sales_layout(singleton,body) VALUES(true,?::text::jsonb)
                ON CONFLICT(singleton) DO UPDATE SET body=excluded.body`).bind(JSON.stringify(body)).run();
            await recordAudit(tx,user,'direct_sales_layout',body.seller,{updated:true});
            return {id:'layout'};
        }
        case 'payment':
        case 'opening': {
            const customer=await customerById(tx,String(v.customer||''));
            const amount=cents(v.amount);
            if (!amount) throw Error('Enter an amount above zero.');
            const date=dateValue(v.date);
            if(v.op==='opening') {
                const booked=await tx.prepare(`
                    SELECT min(date)::text AS date FROM (
                        SELECT date FROM inventory.sales_documents WHERE customer=? AND kind<>'booking' AND voided_at IS NULL
                        UNION ALL SELECT date FROM inventory.sales_customer_money WHERE customer=?
                    ) a`).bind(customer.id,customer.id).first<{date:string|null}>();
                if (booked?.date && date>booked.date) throw Error('Opening balance date must be on or before the first transaction.');
                if (await tx.prepare("SELECT 1 FROM inventory.sales_customer_money WHERE customer=? AND kind='opening'").bind(customer.id).first())
                    throw Error('An opening balance is already recorded for this customer.');
            }
            const signed=v.op==='payment'?(v.direction==='refund'?amount:-amount):v.direction==='credit'?-amount:amount;
            const method=v.op==='payment'?paymentMethod(v.method,amount):'';
            await tx.prepare(`INSERT INTO inventory.sales_customer_money(id,customer,date,kind,amount,method,notes,actor_id,actor)
                VALUES(?,?,?::date,?,?,?,?,?,?)`).bind(id,customer.id,date,v.op,signed,method,value(v.notes,800,'notes'),user.id,user.name).run();
            return {id};
        }
        case 'job_advance': {
            const company=String(v.company||'');
            if(!await tx.prepare("SELECT id FROM companies WHERE id=? AND ownership='EXTERNAL' AND office_only=0").bind(company).first())
                throw Error('Choose a jobwork company.');
            const amount=cents(v.amount);
            if (!amount) throw Error('Enter an advance amount above zero.');
            await tx.prepare(`INSERT INTO inventory.sales_job_advances(id,company,date,amount,notes,actor)
                VALUES(?,?,?::date,?,?,?)`).bind(id,company,dateValue(v.date),amount,value(v.notes,800,'notes'),user.name).run();
            return {id};
        }
        case 'void': {
            if(!isOwner(user.role))throw rejectSales('Only Owner can delete saved documents.',403);
            const previous=await existingDocument(tx,String(v.id||''),v.revision);
            if(v.confirm!==true)throw Error('Confirm before deleting this document.');
            await verifyChangeAllowed(tx,previous);
            const reason=value(v.reason,800,'deletion reason');
            await postStock(tx,user,previous.id,previous.number,previous.date,'direct_sale_void',netStock([],previous.stock_delta),reason);
            const revision=previous.revision+1;
            await tx.prepare('UPDATE inventory.sales_documents SET voided_at=clock_timestamp(),updated_at=clock_timestamp(),revision=? WHERE id=?')
                .bind(revision,previous.id).run();
            await storeRevision(tx,user,previous.id,revision,'deleted',{previous,reason});
            return {id:previous.id};
        }
        case 'document': return saveDocument(tx,user,v,id);
        default: throw Error('Choose a Direct Sell action.');
    }
}

async function existingDocument(tx:Tx,id:string,revision:unknown) {
    const previous=await tx.prepare(`SELECT id,kind,gst,fiscal_year,number,date::text,customer,booking_id,revision,body,stock_delta,
        total::float8,paid::float8,created_at,updated_at,voided_at
        FROM inventory.sales_documents WHERE id=? FOR UPDATE`).bind(id).first<StoredSale>();
    if(!previous || previous.voided_at) throw rejectSales('This document is no longer active.',409);
    if(previous.revision!==revision) throw rejectSales('The document changed. Reopen it before editing.',409);
    return previous;
}

async function verifyChangeAllowed(tx:Tx, doc:StoredSale) {
    if(doc.kind==='bill' && await tx.prepare(`
        SELECT 1 FROM inventory.sales_documents d CROSS JOIN LATERAL jsonb_array_elements(d.body->'lines') l
        WHERE d.customer=? AND d.id<>? AND d.voided_at IS NULL AND l->>'returnFrom' IN (
            SELECT x->>'id' FROM jsonb_array_elements(?::text::jsonb) x
        ) LIMIT 1`).bind(doc.customer,doc.id,JSON.stringify(doc.body.lines)).first())
        throw Error('Reverse the linked customer returns before changing this bill.');
    if(doc.stock_delta.length && await tx.prepare(`
        SELECT 1 FROM inventory.production_events r WHERE r.kind='reset' AND r.created_at>?
        AND NOT EXISTS (SELECT 1 FROM inventory.production_events u WHERE u.kind='undo_reset' AND u.payload->>'document'=r.id::text)
        LIMIT 1`).bind(doc.updated_at).first()) throw Error('A stock reset followed this bill. Use a new correction record.');
}

async function storeRevision(tx:Tx,user:InventoryUser,id:string,revision:number,operation:string,snapshot:unknown) {
    await tx.prepare(`INSERT INTO inventory.sales_document_revisions(document,revision,operation,actor_id,actor,snapshot)
        VALUES(?,?,?,?,?,?::text::jsonb)`).bind(id,revision,operation,user.id,user.name,JSON.stringify(snapshot)).run();
}

async function saveDocument(tx:Tx,user:InventoryUser,v:Fields,id:string) {
    const prev=v.id?await existingDocument(tx,String(v.id),v.revision):null;
    if (prev) {
        id=prev.id;
        await verifyChangeAllowed(tx,prev);
        if (prev.kind==='booking' && await tx.prepare('SELECT 1 FROM inventory.sales_documents WHERE booking_id=? AND voided_at IS NULL LIMIT 1').bind(prev.id).first())
            throw Error('This booking has a final bill. Edit the bill instead.');
    }
    const kind=v.kind as SaleKind;
    if (!['bill','booking','return'].includes(kind)) throw Error('Choose bill, booking or return.');
    const gst=v.gst===true;
    const date=dateValue(v.date), year=fiscalYear(date);
    const customer=await customerById(tx,String(v.customer||''));
    if (prev && (prev.kind!==kind||prev.gst!==gst||prev.fiscal_year!==year||prev.customer!==customer.id))
        throw Error('Customer, bill type and financial year stay fixed on a saved document.');
    if (gst) {
        customer.gst=gstNumber(value(v.gstNumber,15,'customer GSTIN',true));
        customer.address=value(v.address,800,'customer address',true);
        customer.phone=value(v.phone,50,'customer phone');
    }
    const settings=prev?.body.layout ?? (await tx.prepare('SELECT body FROM inventory.sales_layout WHERE singleton').first<{body:SalesLayout}>())?.body ?? blankLayout;
    const place=value(v.place,120,'place of supply',gst);
    if(gst && (!settings.address||!settings.gst))throw Error('Save TaraFabbs address and supplier GSTIN in Bill Layout first.');
    const taxMode=v.taxMode==='interstate'?'interstate':'local';
    if(gst && (settings.gst.slice(0,2)!==customer.gst.slice(0,2))!==(taxMode==='interstate'))
        throw Error('Check the tax type against the supplier and customer GSTIN state codes.');
    const cgstRate=gst&&taxMode==='local'?rate(v.cgst||0):0,sgstRate=gst&&taxMode==='local'?rate(v.sgst||0):0;
    const igstRate=gst&&taxMode==='interstate'?rate(v.igst||0):0;
    if(cgstRate+sgstRate+igstRate>10000)throw Error('Combined tax rate must be at most 100%.');
    if (!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100) throw Error('Add between 1 and 100 products.');
    const lines:SaleLine[]=[];
    const returned=new Map<string,number>();
    for (const row of v.lines as SaleInputLine[]) {
        if (!row || typeof row !== 'object') throw Error('Check the product rows.');
        const type = row.type==='return'?'return':'sale';
        if ((kind==='booking'&&type==='return')||(kind==='return'&&type!=='return')) throw Error('Choose the right product row for this document.');
        const line:SaleLine={id:randomUUID(),name:'',quantity:units(row.quantity),unit:cents(row.unit,'Unit price'),hsn:'',sku:'',type};
        if (row.returnFrom) {
            if(type!=='return') throw Error('A previous sale can only be used for a return.');
            const origin=await returnLine(tx,customer.id,String(row.returnFrom),id);
            const amount=(returned.get(origin.line.id)||0)+line.quantity;
            if(amount>origin.max)throw Error('Return quantity exceeds the pieces still eligible for return.');
            if(origin.gst!==gst || (gst && (origin.cgst!==cgstRate||origin.sgst!==sgstRate||origin.igst!==igstRate)))
                throw Error('Use the original bill’s GST type and rates for this return.');
            if(line.unit > origin.line.unit) throw Error('Return price cannot exceed the original unit price.');
            returned.set(origin.line.id,amount);
            Object.assign(line,{name:origin.line.name,hsn:origin.line.hsn,sku:origin.line.sku,source:origin.line.source,product:origin.line.product,returnFrom:origin.line.id});
        } else if (row.source) {
            if(type==='return')throw Error('Link the original sale item to put a return back into stock.');
            const source=await tx.prepare(`
                SELECT b.key,b.company,b.product,b.pool,b.stage,b.arts,b.work,b.artisan,p.name,c.active
                FROM inventory.production_balances b JOIN companies c ON c.id=b.company JOIN products p ON p.id=b.product
                WHERE b.key=? AND b.pool='normal' AND c.ownership='OWN' AND c.office_only=0
            `).bind(String(row.source)).first<StockSource>();
            if(!source||!saleStages.some(stage=>stage===source.stage)||(!source.active&&!prev?.stock_delta.some(d=>accountKey(d)===source.key)))
                throw Error('Choose eligible TaraFabbs stock.');
            const details=await tx.prepare('SELECT id,name,hsn,sku FROM inventory.sales_products WHERE stock_product=?')
                .bind(source.product).first<SalesProduct>();
            const {company,product,pool,stage,arts,work,artisan}=source;
            Object.assign(line,{name:source.name+(arts?' · '+arts:''),hsn:details?.hsn||'',sku:details?.sku||'',product:details?.id,source:{company,product,pool,stage,arts,work,artisan}});
        } else {
            const product=await tx.prepare('SELECT id,name,hsn,sku,stock_product FROM inventory.sales_products WHERE id=?')
                .bind(String(row.product||'')).first<SalesProduct>();
            if(!product||product.stock_product)throw Error('Choose a catalogue product or a specific stock row.');
            Object.assign(line,{name:product.name,hsn:product.hsn,sku:product.sku,product:product.id});
        }
        // Rates and catalogue defaults can evolve. Preserve the printed data of an existing stock line.
        const priorLine=prev?.body.lines.find(l=>l.type===type && (line.source ? l.source && accountKey(l.source)===accountKey(line.source) : l.product===line.product) && l.returnFrom===line.returnFrom);
        if(priorLine && !line.returnFrom)Object.assign(line,{name:priorLine.name,hsn:priorLine.hsn,sku:priorLine.sku});
        if(gst && !line.returnFrom && row.hsn!==undefined) line.hsn=value(row.hsn,8,'HSN');
        if(gst && !/^\d{4,8}$/.test(line.hsn))throw Error('Enter a 4–8 digit HSN for each GST product.');
        lines.push(line);
    }
    const discount=cents(v.discount||0,'Discount'),additional=cents(v.additional||0,'Additional charges');
    const amounts=calculateSale(lines,discount,additional,cgstRate,sgstRate,igstRate);
    if(kind==='booking' && amounts.total<=0)throw Error('Enter a booking total above zero.');
    if(kind==='return' && amounts.total>=0)throw Error('A return must credit an amount above zero.');
    if(kind==='bill' && amounts.total<0)throw Error('Use Customer Return for a net credit.');
    if(discount>Math.max(0,amounts.subtotal+additional))throw Error('Discount exceeds the bill value.');
    const received=cents(v.received||0,kind==='return'?'Refund':'Payment');
    const method=paymentMethod(v.method,received);
    let bookingId:string|null=null;
    let bookingAdvance=0;
    if(v.bookingId) {
        if(kind!=='bill')throw Error('A booking advance can only be applied to a bill.');
        const booking=await tx.prepare("SELECT customer,paid::float8,voided_at,date::text FROM inventory.sales_documents WHERE id=? AND kind='booking' FOR UPDATE")
            .bind(String(v.bookingId)).first<{customer:string;paid:number;voided_at:string|null;date:string}>();
        if(!booking||booking.customer!==customer.id||booking.date>date||(booking.voided_at&&prev?.booking_id!==v.bookingId))
            throw Error('Choose an open booking for this customer.');
        if(await tx.prepare('SELECT 1 FROM inventory.sales_documents WHERE booking_id=? AND voided_at IS NULL AND id<>?').bind(String(v.bookingId),id).first())
            throw Error('That booking was already converted to a bill.');
        bookingId=String(v.bookingId);
        bookingAdvance=booking.paid;
    }
    if(prev?.booking_id && bookingId!==prev.booking_id)
        throw Error('Keep the original booking link when editing this bill.');
    if (received+bookingAdvance>Math.abs(amounts.total)) throw Error('Payment or refund cannot exceed the total.');
    const paid=kind==='return'?-received:received+bookingAdvance;
    const series=seriesFor(kind,gst);
    const number=prev?.number||await nextNumber(tx,series,year);
    const notes=value(v.notes,1200,'notes');
    const body:SaleBody={customer,layout:settings,lines,discount,additional,taxMode,cgstRate,sgstRate,igstRate,place,notes,method,received,bookingAdvance,...amounts};
    const stockDelta=kind==='booking'?[]:netStock(lines);
    await postStock(tx,user,id,number,date,prev?'direct_sale_edit':kind==='return'?'direct_customer_return':'direct_sale',netDeltas([...netStock([],prev?.stock_delta),...stockDelta]),notes);
    const revision=(prev?.revision||0)+1;
    await tx.prepare(`INSERT INTO inventory.sales_documents
        (id,kind,gst,fiscal_year,number,date,customer,booking_id,revision,body,stock_delta,total,paid)
        VALUES(?,?,?,?,?,?::date,?,?,?,?::text::jsonb,?::text::jsonb,?,?)
        ON CONFLICT(id) DO UPDATE SET date=excluded.date,booking_id=excluded.booking_id,revision=excluded.revision,body=excluded.body,
          stock_delta=excluded.stock_delta,total=excluded.total,paid=excluded.paid,updated_at=clock_timestamp()
    `).bind(id,kind,gst,year,number,date,customer.id,bookingId,revision,JSON.stringify(body),JSON.stringify(stockDelta),amounts.total,paid).run();
    await storeRevision(tx,user,id,revision,prev?'edited':'created',{number,date,gst,kind,body,stockDelta,paid,total:amounts.total,bookingId});
    return {id,number};
}

async function returnLine(tx:Tx, customer:string, original:string, editing:string) {
    const match=await tx.prepare(`
        WITH used AS (
            SELECT coalesce(sum((l->>'quantity')::int),0)::int AS quantity
            FROM inventory.sales_documents d CROSS JOIN LATERAL jsonb_array_elements(d.body->'lines') l
            WHERE d.customer=? AND d.id<>? AND d.voided_at IS NULL AND l->>'returnFrom'=? AND l->>'type'='return'
        )
        SELECT l AS line,(l->>'quantity')::int-used.quantity AS max,d.gst,
               (d.body->>'cgstRate')::int AS cgst,(d.body->>'sgstRate')::int AS sgst,(d.body->>'igstRate')::int AS igst
        FROM inventory.sales_documents d CROSS JOIN LATERAL jsonb_array_elements(d.body->'lines') l CROSS JOIN used
        WHERE d.customer=? AND d.kind='bill' AND d.id<>? AND d.voided_at IS NULL AND l->>'id'=? AND l->>'type'='sale'
    `).bind(customer,editing,original,customer,editing,original).first<{line:SaleLine;max:number;gst:boolean;cgst:number;sgst:number;igst:number}>();
    if(!match)throw Error('Choose an item sold to this customer.');
    return match;
}

async function nextNumber(tx:Tx,series:string,year:number) {
    const next=await tx.prepare(`INSERT INTO inventory.sales_sequences(series,year,last_number) VALUES(?,?,1)
        ON CONFLICT(series,year) DO UPDATE SET last_number=inventory.sales_sequences.last_number+1 RETURNING last_number`)
        .bind(series,year).first<{last_number:number}>();
    if(!next)throw Error('Could not allocate the bill number.');
    return documentNumber(series,year,next.last_number);
}

function netDeltas(deltas:Delta[]) {
    const totals=new Map<string,Delta>();
    for (const d of deltas) {
        const key=accountKey(d);
        totals.set(key,{...d,quantity:(totals.get(key)?.quantity||0)+d.quantity});
    }
    return [...totals.values()].filter(d=>d.quantity);
}

async function postStock(tx:Tx,user:InventoryUser,document:string,reference:string,date:string,kind:string,deltas:Delta[],notes:string) {
    const net=netDeltas(deltas);
    if(!net.length)return;
    for(const d of net) {
        const key=accountKey(d);
        const row=await tx.prepare('SELECT quantity FROM inventory.production_balances WHERE key=? FOR UPDATE').bind(key).first<{quantity:number}>();
        const remaining=(row?.quantity||0)+d.quantity;
        if(remaining<0)throw rejectSales('Selected TaraFabbs stock is insufficient. Review the quantities.',409);
        if(row)await tx.prepare('UPDATE inventory.production_balances SET quantity=?,since=CASE WHEN quantity=0 THEN clock_timestamp() ELSE since END WHERE key=?')
            .bind(remaining,key).run();
        else await tx.prepare('INSERT INTO inventory.production_balances(key,company,product,pool,stage,artisan,arts,work,quantity) VALUES(?,?,?,?,?,?,?,?,?)')
            .bind(key,d.company,d.product,d.pool,d.stage,d.artisan,d.arts,d.work,remaining).run();
    }
    await tx.prepare(`INSERT INTO inventory.production_events(kind,company,event_date,reference,notes,actor_id,actor,actor_role,payload,delta)
        VALUES(?,?,?::date,?,?,?,?,?,?::text::jsonb,?::text::jsonb)`)
        .bind(kind,net[0].company,date,reference,notes,user.id,user.name,roleLabel(user.role),JSON.stringify({kind,date,reference,notes,salesDocument:document}),JSON.stringify(net)).run();
}
