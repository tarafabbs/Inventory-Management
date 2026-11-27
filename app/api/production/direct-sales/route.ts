import { createHash } from 'node:crypto';
import { db } from '@/lib/database';
import { inventorySession } from '@/lib/inventory-identity';
import { isManagement } from '@/lib/rules';
import { bookingCount, customerReturns, jobAdvances, salesDocument, salesHub, salesStatement } from '@/lib/sales-read';
import { rejectSales, salesMutation } from '@/lib/sales-write';

export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

function errorResponse(error:unknown) {
    const dbError='code' in Object(error);
    if(dbError)console.error('Direct Sell database error:',(error as {code?:string}).code);
    return reply({error:error instanceof Error&&!dbError?error.message:'Direct Sell could not complete this action. Try again.'},
        (error as {status?:number})?.status|| (dbError?503:400));
}

export async function GET(request:Request) {
    try {
        const {signedIn,staff}=await inventorySession();
        if(!signedIn||!staff||!isManagement(staff.role))return reply({error:'Management access required.'},403);
        const q=new URL(request.url).searchParams;
        switch(q.get('view')) {
            case 'ifsc': {
                const ifsc=(q.get('ifsc')||'').trim().toUpperCase();
                if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))return reply({error:'Enter a valid 11-character IFSC.'},400);
                let response:Response;
                try { response=await fetch(`https://ifsc.razorpay.com/${ifsc}`,{cache:'no-store',signal:AbortSignal.timeout(8_000)}); }
                catch { return reply({error:'Could not check IFSC now. Please retry.'},503); }
                if(response.status===404)return reply({error:'IFSC not found. Check the code.'},404);
                if(!response.ok)return reply({error:'Could not check IFSC now. Please retry.'},503);
                let bank:unknown,branch:unknown,found:unknown;
                try { const data=await response.json();bank=data.BANK;branch=data.BRANCH;found=data.IFSC; }
                catch { return reply({error:'Could not read IFSC details. Please retry.'},503); }
                if(typeof bank!=='string'||!bank.trim()||typeof branch!=='string'||!branch.trim()||found!==ifsc)
                    return reply({error:'Could not verify IFSC details. Please retry.'},503);
                return reply({bank:bank.trim().slice(0,120),branch:branch.trim().slice(0,120),ifsc});
            }
            case 'count': return reply({count:await bookingCount()});
            case 'document': {
                const document=await salesDocument(q.get('id')||'');
                return document?reply(document):reply({error:'Document not found.'},404);
            }
            case 'returns': return reply(await customerReturns(q.get('customer')||'',q.get('editing')||''));
            case 'statement': return reply(await salesStatement(q.get('customer')||''));
            case 'job_advances': return reply(await jobAdvances(q.get('company')||''));
            default: return reply(await salesHub());
        }
    } catch(error) { return errorResponse(error); }
}

export async function POST(request:Request) {
    try {
        if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)
            throw rejectSales('Use the inventory site.',403);
        const {signedIn,staff}=await inventorySession();
        if(!signedIn||!staff||!isManagement(staff.role))return reply({error:'Management access required.'},403);
        const input=await request.text();
        if(input.length>1_200_000)throw rejectSales('Resize the layout images before saving.',413);
        const {key,...values}=JSON.parse(input);
        if(typeof key!=='string'||!/^[a-f0-9-]{36}$/i.test(key))throw Error('Reload this form.');
        const fingerprint=createHash('sha256').update(input).digest('hex');
        const result=await db.transaction(async tx=>{
            await tx.prepare("SELECT pg_advisory_xact_lock(hashtextextended('production-posting',0))").run();
            if(!await tx.prepare('SELECT id FROM users WHERE id=? AND role=? AND active=1 FOR SHARE').bind(staff.id,staff.role).first())
                throw rejectSales('Your access changed.',403);
            const previous=await tx.prepare('SELECT fingerprint,actor_id,result FROM inventory.production_requests WHERE id=?')
                .bind(key).first<{fingerprint:string;actor_id:string;result:unknown}>();
            if(previous){
                if(previous.fingerprint!==fingerprint||previous.actor_id!==staff.id)throw rejectSales('This request belongs to a different entry.',409);
                return previous.result;
            }
            const result=await salesMutation(tx,staff,values);
            await tx.prepare('INSERT INTO inventory.production_requests(id,actor_id,fingerprint,result) VALUES(?,?,?,?::text::jsonb)')
                .bind(key,staff.id,fingerprint,JSON.stringify(result)).run();
            return result;
        });
        return reply(result);
    } catch(error) { return errorResponse(error); }
}
