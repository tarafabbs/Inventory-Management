import type {Account,Balance,Command,Document} from './production';
export type Master = {
    id: string;
    name: string;
    active: number;
    profile_status?: 'active' | 'paused' | 'archived' | 'deleted';
    ownership?: string;
    office_only?: number;
    contact?: string;
    address?: string;
    notes?: string;
    work_type?: string;
    work_description?: string;
    work_types?: string[];
};
export type Event = {
    id: string;
    company?: string;
    kind: string;
    event_date: string;
    reference: string;
    notes: string;
    actor: string;actor_id?:string;
    actor_role: string;
    created_at: string;
    reversed?: boolean;
    payload: Command & {
        correctionKind?: string;
    };
    delta: (Account & {
        quantity: number;
    })[];
};
export type Snapshot = {
    user: {
        id: string;
        name: string;
        role: string;
    };
    balances: Balance[];
    companies: Master[];
    products: Master[];
    artisans: Master[];
    money: {
        company: string;
        due: number;
    }[];
    documents: Document[];
    history: Event[];
    more: boolean;
    openingDate: string;
};
