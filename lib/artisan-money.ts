import { paise } from './production';
export type ArtisanMoneyKind = 'opening'|'charge'|'payment'|'refund'|'adjustment'|'reversal'|'stock_correction';
export type ArtisanMoneyCommand = {artisan:string;date:string;kind:ArtisanMoneyKind;amount?:number;reference?:string;notes?:string;entry?:string};
export function artisanMoneyAmount(c:ArtisanMoneyCommand, balance:number) {
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||Number.isNaN(Date.parse(c.date+'T00:00:00Z'))||new Date(c.date+'T00:00:00Z').toISOString().slice(0,10)!==c.date||c.date>today)throw Error('Choose a valid date.');
    if(!['opening','charge','payment','refund','adjustment'].includes(c.kind))throw Error('Choose a valid artisan money entry.');
    const amount=c.amount;
    if(typeof amount!=='number'||!Number.isFinite(amount))throw Error('Enter a valid amount with at most two decimals.');
    const signed=['opening','adjustment'].includes(c.kind);
    const value=paise(signed?Math.abs(amount):amount);
    if(!value)throw Error('Enter an amount greater than zero.');
    if(c.kind==='adjustment'&&!c.notes?.trim())throw Error('Enter an adjustment reason.');
    if(c.kind==='refund'&&value>Math.max(0,-balance))throw Error('Cash returned cannot exceed the artisan advance balance.');
    return c.kind==='payment'?-value:signed?Math.sign(amount)*value:value;
}
