export const stockOperations = {
  receipt: {label: 'New Entry', from: null, to: 'raw', permission: 'receipt'},
  accept_pending: {label: 'Confirm older pending stock', from: 'pending', to: 'raw', permission: 'receipt'},
  issue: {label: 'Send to artisan', from: 'raw', to: 'artisan', permission: 'handoff'},
  receive: {label: 'Receive from artisan', from: 'artisan', to: 'ready', permission: 'return'},
  receive_repair: {label: 'Receive for repair', from: 'artisan', to: 'repair', permission: 'return'},
  receive_dispute: {label: 'Receive as disputed', from: 'artisan', to: 'disputed', permission: 'return'},
  mark_repair: {label: 'Mark for repair', from: 'ready', to: 'repair', permission: 'dispute'},
  send_repair: {label: 'Send for repair', from: 'repair', to: 'repair_artisan', permission: 'reprintOut'},
  receive_repaired: {label: 'Receive repaired pieces', from: 'repair_artisan', to: 'ready', permission: 'reprintReceive'},
  mark_dispute: {label: 'Mark as disputed', from: 'ready', to: 'disputed', permission: 'dispute'},
  raw_dispute: {label: 'Mark raw pieces as disputed', from: 'raw', to: 'disputed', permission: 'dispute'},
  repair_dispute: {label: 'Move repair pieces to dispute', from: 'repair', to: 'disputed', permission: 'dispute'},
  resolve_dispute: {label: 'Move dispute to repair', from: 'disputed', to: 'repair', permission: 'reprintOut'},
  dispute_return: {label: 'Return disputed pieces to company', from: 'disputed', to: 'dispute_returned', permission: 'supplierReturn'},
  dispatch: {label: 'Deliver to company', from: 'ready', to: 'delivered', permission: 'postFinish'},
  send_office: {label: 'Send Own Product to Office', from: 'ready', to: 'office_pending', permission: 'postFinish'},
  receive_factory_return: {label: 'Receive dispute at workshop', from: 'factory_return_pending', to: 'disputed', permission: 'postFinish'},
  office_receive: {label: 'Receive TaraFabbs Own Product', from: 'office_pending', to: 'office_stock', permission: 'officeReceive'},
  office_vendor_receipt: {label: 'Office New Entry · Outside Vendor', from: null, to: 'office_stock', permission: 'officeEntry'},
  office_accept_pending: {label: 'Confirm older vendor stock', from: 'office_vendor_pending', to: 'office_stock', permission: 'officeEntry'},
  office_sell: {label: 'Mark sold', from: 'office_stock', to: 'office_sold', permission: 'officeSell'},
  office_dispute_return: {label: 'Dispute return to workshop', from: 'office_stock', to: 'factory_return_pending', permission: 'officeReturn'},
  office_customer_return: {label: 'Dispute return from customer', from: 'office_sold', to: 'factory_return_pending', permission: 'officeReturn'},
} as const;

export type StockOperation = keyof typeof stockOperations;
export type StockStage = 'raw' | 'artisan' | 'ready' | 'repair' | 'repair_artisan'
  | 'disputed' | 'dispute_returned' | 'delivered' | 'pending' | 'review'
  | 'office_pending' | 'office_vendor_pending' | 'office_stock' | 'office_sold' | 'factory_return_pending';

export const stageLabels: Record<StockStage, string> = {
  raw: 'Raw stock',
  artisan: 'With artisans',
  ready: 'Ready for company',
  repair: 'Waiting for repair',
  repair_artisan: 'Out for repair',
  disputed: 'Disputed in stock',
  dispute_returned: 'Dispute returned',
  delivered: 'Delivered to company',
  pending: 'Legacy pending intake',
  review: 'Legacy location review',
  office_pending: 'Awaiting Office receipt',
  office_vendor_pending: 'Older vendor stock awaiting receipt',
  office_stock: 'Office stock',
  office_sold: 'Sold',
  factory_return_pending: 'Awaiting workshop receipt',
};

export const officeOperations = [
  'office_receive','office_vendor_receipt','office_accept_pending','office_sell','office_dispute_return','office_customer_return',
] as const satisfies readonly StockOperation[];

export function isOfficeOperation(operation: string) {
  return (officeOperations as readonly string[]).includes(operation);
}

export const ownsOfficeTransfer = (operation: StockOperation) => [
  'send_office','receive_factory_return','office_receive','office_dispute_return','office_customer_return',
].includes(operation);

export const needsDisputeReason = (operation: StockOperation) =>
  (stockOperations[operation].to === 'disputed' && operation !== 'receive_factory_return') ||
  ['dispute_return','office_dispute_return','office_customer_return'].includes(operation);

export type StockMaster = {id: string; name: string; active: number; ownership?: string; office_only?: number};
export type StockBalance = {
  company_id: string;
  product_id: string;
  artisan_id: string | null;
  stage: StockStage;
  quantity: number;
};
export type StockTotals = {
  company_id: string;
  product_id: string;
  received: number;
  issued: number;
  artist_returns: number;
};
export type StockHistory = {
  id: string;
  company_id: string;
  product_id: string;
  artisan_id: string | null;
  kind: StockOperation | 'issue_edit' | 'office_entry_edit' | 'legacy';
  quantity: number;
  original_quantity: number;
  previous_quantity: number | null;
  new_quantity: number | null;
  created_at: string;
  reference: string;
  notes: string;
  actor: string;
  actor_role: string | null;
  actor_id: string | null;
  received_on: string | null;
};
export type StockSnapshot = {
  user: {id: string; name: string; role: string};
  companies: StockMaster[];
  products: StockMaster[];
  artisans: StockMaster[];
  thanwalas: StockMaster[];
  balances: StockBalance[];
  totals: StockTotals[];
  history: StockHistory[];
  more: boolean;
};

export const maxStockQuantity = 1_000_000;
export const issueEditWindow = 7 * 24 * 60 * 60 * 1000;

export function trackedArtisan(stage: StockStage | null, artisanId: string | null) {
  return stage === 'artisan' || stage === 'repair_artisan' ? artisanId : null;
}

export function stockAvailable(
  balances: StockBalance[],
  companyId: string,
  productId: string,
  stage: StockStage | null,
  artisanId: string | null,
) {
  if (!stage) return 0;
  return balances.find(row => row.company_id === companyId && row.product_id === productId
    && row.stage === stage && row.artisan_id === trackedArtisan(stage, artisanId))?.quantity ?? 0;
}

export const stockHistoryPageSize = 30;
