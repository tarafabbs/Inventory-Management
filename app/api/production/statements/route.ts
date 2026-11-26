import {inventorySession} from '@/lib/inventory-identity';
import {isOfficeRole,permitted} from '@/lib/rules';
import {statementSource} from '@/lib/statement-source';
import {buildStatement,statementFilter} from '@/lib/statements';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const headers={'Cache-Control':'no-store'};
 try{
  const {staff,signedIn}=await inventorySession();
  if(!staff||!signedIn||!permitted(staff.role,'read')||isOfficeRole(staff.role))return Response.json({error:'Workshop access required.'},{status:403,headers});
  const filter=statementFilter(new URL(request.url).searchParams);
  return Response.json(buildStatement(await statementSource(filter),filter),{headers});
 }catch(e){return Response.json({error:e instanceof Error&&!('code'in e)?e.message:'Could not load the statement. Please retry.'},{status:'code'in Object(e)?503:400,headers});}
}
