import type { Account, Delta } from './production';

export const salesDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const saleStages = ['raw', 'ready', 'office_stock'] as const;
export type SalesCustomer = { id: string; name: string; address: string; phone: string; gst: string };
export type SalesProduct = { id: string; name: string; price: number; hsn: string; sku: string; stock_product?: string | null };
export type SalesLayout = {
    seller: string; address: string; phone: string; gst: string; bank: string;
    bankName: string; accountNumber: string; ifsc: string; branch: string;
    logo: string; signature: string; qr: string; bankImage: string;
};
export const blankLayout: SalesLayout = {
    seller: 'TaraFabbs', address: '', phone: '', gst: '', bank: '', bankName: '', accountNumber: '', ifsc: '', branch: '', logo: '', signature: '', qr: '', bankImage: '',
};

export type SaleKind = 'bill' | 'booking' | 'return';
export type SaleLine = {
    id: string; name: string; quantity: number; unit: number; hsn: string; sku: string;
    type: 'sale' | 'return'; product?: string; source?: Account; returnFrom?: string;
};
export type SaleInputLine = {
    quantity: unknown; unit: unknown; type?: unknown; source?: unknown; product?: unknown; returnFrom?: unknown; hsn?: unknown;
};
export type SaleBody = {
    customer: SalesCustomer; layout: SalesLayout; lines: SaleLine[];
    discount: number; additional: number; taxMode: 'local' | 'interstate';
    cgstRate: number; sgstRate: number; igstRate: number; place: string; notes: string;
    method: string; received: number; bookingAdvance: number;
    subtotal: number; taxable: number; cgst: number; sgst: number; igst: number;
};
export type SaleDocument = {
    id: string; kind: SaleKind; gst: boolean; fiscal_year: number; number: string; date: string;
    customer: string; booking_id: string | null; revision: number; body: SaleBody;
    total: number; paid: number; voided_at: string | null; actor?: string;
};
export type SaleSummary = Pick<SaleDocument, 'id'|'kind'|'gst'|'number'|'date'|'customer'|'total'|'paid'|'voided_at'|'booking_id'>;
export type ReturnOption = { id: string; number: string; line: SaleLine; remaining: number; gst:boolean; taxMode:'local'|'interstate'; cgstRate:number; sgstRate:number; igstRate:number; place:string };
export type SalesLedgerRow = { id: string; customer: string; date: string; label: string; amount: number; created_at: string; position: number };
export type SalesHub = {
    customers: SalesCustomer[]; products: SalesProduct[]; documents: SaleSummary[]; layout: SalesLayout;
    balances: { customer: string; due: number }[]; bookings: number;
};

export function dateValue(value: unknown) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value
        || value > salesDay()) throw Error('Choose a valid date on or before today.');
    return value;
}

export function fiscalYear(date: string) {
    return Number(date.slice(0,4)) - (date.slice(5,7) < '04' ? 1 : 0);
}

export const seriesFor = (kind: SaleKind, gst: boolean) =>
    kind === 'booking' ? 'B' : kind === 'return' ? (gst ? 'CR' : 'R') : gst ? 'G' : 'S';

export function documentNumber(series: string, year: number, serial: number) {
    return series + '-' + String(year).slice(-2) + '-' + String(serial).padStart(4,'0');
}

export function cents(value: unknown, label = 'Amount') {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e9 || Math.abs(n*100-Math.round(n*100)) > 1e-4)
        throw Error(label + ' must be a non-negative amount with up to two decimals.');
    return Math.round(n*100);
}

export function units(value: unknown) {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000) throw Error('Enter a whole quantity between 1 and 1,000,000.');
    return n;
}

export function rate(value: unknown) {
    const n = cents(value, 'Tax rate');
    if (n > 10000) throw Error('Each tax rate must be 0–100%.');
    return n;
}

export function calculateSale(lines: Pick<SaleLine,'quantity'|'unit'|'type'>[], discount: number, additional: number,
    cgstRate: number, sgstRate: number, igstRate: number) {
    const subtotal = lines.reduce((sum,line)=>sum + line.unit*line.quantity*(line.type==='return'?-1:1),0);
    const taxable = subtotal - discount + additional;
    if (!Number.isSafeInteger(taxable) || Math.abs(taxable) > 1e11) throw Error('Check the bill quantities and totals.');
    const tax = (rateInBasisPoints:number) => Math.sign(taxable)*Math.round(Math.abs(taxable)*rateInBasisPoints/10000);
    const cgst=tax(cgstRate), sgst=tax(sgstRate), igst=tax(igstRate);
    return {subtotal,taxable,cgst,sgst,igst,total:taxable+cgst+sgst+igst};
}

export function netStock(lines: SaleLine[], old: Delta[] = []): Delta[] {
    const result: Delta[] = old.map(d=>({...d,quantity:-d.quantity}));
    for (const l of lines) if (l.source) result.push({...l.source,quantity:l.type==='return'?l.quantity:-l.quantity});
    return result;
}

export function gstNumber(input: string) {
    const value=input.trim().toUpperCase();
    if (value && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value)) throw Error('Enter a valid 15-character GSTIN.');
    return value;
}
