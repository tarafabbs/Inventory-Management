'use client';
import React,{useState} from 'react';
import {Building2,Package,Printer,ShieldCheck} from 'lucide-react';

function Field({label,hint,children}:any){return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>}

export default function OfficeNewEntryForm({d,action,busy,onPrint}:any){
 const vendors=d.companies.filter((c:any)=>c.office_only===1),products=d.products.filter((p:any)=>p.office_only===1);
 const [vendor,setVendor]=useState(vendors[0]?.id||'NEW'),[product,setProduct]=useState(products[0]?.id||'NEW');
 const today=new Date().toLocaleDateString('en-CA',{timeZone:d.settings.timezone||'Asia/Kolkata'});
 return <form onSubmit={async e=>{e.preventDefault();const values:any=Object.fromEntries(new FormData(e.currentTarget));values.company_id=vendor==='NEW'?'':vendor;values.product_id=product==='NEW'?'':product;values.quantity=Number(values.quantity);const saved=await action('officeNewEntry',values);if(saved?.codes)onPrint(saved.codes,saved.count)}}>
  <div className="recovery-intro"><ShieldCheck size={20}/><div><b>Office-only entry</b><p>This is only for products physically received from an outside vendor at the office. TaraFabbs workshop products must use Factory Finished Goods Received.</p></div></div>
  <div className="form-grid margin-top">
   <Field label="Outside vendor"><select value={vendor} onChange={e=>setVendor(e.target.value)}>{vendors.map((c:any)=><option key={c.id} value={c.id}>{c.name} · {c.prefix}</option>)}<option value="NEW">+ Create outside vendor</option></select></Field>
   <Field label="Office product"><select value={product} onChange={e=>setProduct(e.target.value)}>{products.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}<option value="NEW">+ Create office product</option></select></Field>
  </div>
  {vendor==='NEW'&&<section className="panel compact-panel margin-top"><div className="panel-heading"><div><h3><Building2 size={17}/> New outside vendor</h3><p>Creates a separate office source; it will not appear in workshop operations.</p></div></div><div className="form-grid three"><Field label="Vendor name"><input name="vendor_name" required autoFocus placeholder="Vendor / supplier name"/></Field><Field label="Barcode prefix" hint="2–6 unique uppercase letters"><input name="vendor_prefix" required pattern="[A-Za-z]{2,6}" maxLength={6} onInput={e=>{e.currentTarget.value=e.currentTarget.value.toUpperCase()}} placeholder="VEN"/></Field><Field label="Contact / reference"><input name="vendor_contact" placeholder="Phone or address"/></Field></div></section>}
  {product==='NEW'&&<section className="panel compact-panel margin-top"><div className="panel-heading"><div><h3><Package size={17}/> New office product</h3><p>Product details stay within the office journey and barcode history.</p></div></div><div className="form-grid"><Field label="Product name"><input name="product_name" required placeholder="Saree / product name"/></Field><Field label="Material"><input name="material" placeholder="Cotton, silk…"/></Field><Field label="Weave"><input name="weave"/></Field><Field label="Colour"><input name="color"/></Field><Field label="Design"><input name="design"/></Field></div></section>}
  <div className="form-grid margin-top"><Field label="Vendor bill / challan number"><input name="reference" required maxLength={200} placeholder="INV-2026-001"/></Field><Field label="Office receipt date"><input name="received_at" type="date" required defaultValue={today}/></Field><Field label="Quantity"><input name="quantity" type="number" min="1" max="400" step="1" required defaultValue="1"/></Field></div>
  <Field label="Entry notes"><textarea name="notes" rows={3} maxLength={2000} placeholder="Purchase/order reference, rack, or other office notes"/></Field>
  <div className="info-strip"><Printer size={17}/>Saving reserves one permanent barcode per piece and opens the print labels. The item enters Office Inventory only after its attached label is scanned.</div>
  <div className="modal-footer"><button className="btn primary" disabled={busy}>{busy?'Creating barcodes…':'Create & print barcodes'}<Printer size={16}/></button></div>
 </form>;
}
