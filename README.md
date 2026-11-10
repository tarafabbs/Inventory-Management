# Inventory Management · IMS TARA MAA

This is a Next.js application deployed on Vercel. It stays on the Vercel or custom domain and uses Supabase for Google authentication and PostgreSQL storage.

The inventory tables live in the dedicated `inventory` schema of the existing Tarafabbs Supabase project. This keeps the inventory `products` and `users` separate from the storefront tables in `public`. Database writes remain transactional, and PostgreSQL triggers protect immutable 1–4 character piece codes, custody rules, sequence numbers, and append-only history.

## Supabase configuration

The schema migrations are stored in `supabase/migrations`.

Google sign-in is already in use on this Supabase project. Its Google Cloud authorized redirect URI remains:

`https://gylsoykqbvlcoikvittz.supabase.co/auth/v1/callback`

Under **Supabase Dashboard → Authentication → URL Configuration**, keep the storefront's existing Site URL and add these Redirect URLs:

- Redirect URL: `https://im.tarafabbs.com/auth/callback`
- Optional Vercel fallback: `https://inventory-management-eight-ruby.vercel.app/auth/callback`
- Local development: `http://localhost:3000/auth/callback`

The first Google account to sign in while `inventory.users` is empty becomes the inventory Admin. Later staff must be added by exact Google email in the app's Settings area.

## Vercel environment

Set these variables for Production and Preview:

- `NEXT_PUBLIC_SUPABASE_URL`: the project API URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project's active publishable key
- `SUPABASE_DATABASE_URL`: the transaction pooler URI from **Supabase Dashboard → Connect**, including the database password

The database layer also accepts the standard `POSTGRES_URL` or `DATABASE_URL` names created by hosting integrations. Use the pooler URI on port `6543`; the server disables prepared statements for pooler compatibility. Keep database URLs server-only.

## Local development

Copy `.env.example` to `.env.local`, fill in the Supabase values, and run:

```bash
npm run db:migrate
npm run dev
```

The application includes direct-to-stock New Entry, unique 1–4 character handwritten codes, manual typing or optional on-device photo recognition, one-submit normal movements, handoffs, returns, inventory and artisan balances, stock counts, issue alerts, exceptions, linked reversals and adjustments, staff roles, and CSV/print exports. No barcode is used.

## Handwritten code recovery

Code Recovery is available in Quick actions, All-in-one Code Entry, Code Entry, Office and piece details. Staff can search valid registered pieces or legacy pending codes by original code, bill, lot, company, product or artist. A replacement requires a reason, physical identification evidence and confirmation of an exact match. The original permanent value is reused; recovery never changes stock, custody, condition, intake confirmation or piece version.

Recovery requests persist until the replacement code is typed and confirmed, or cancelled with a reason. Unidentified physical items can be reported separately and matched later; they cannot create inventory. Closed records cannot be edited or deleted. Office roles can only recover pieces within their Office scope. Viewer access cannot create recoveries.

The recovery screen accepts any readable 2–4 character fragment from a damaged tag. Fragment matching ignores spaces and hyphens, then marks results as exact, partial-code or record-detail matches before physical verification and rewriting the tag.

## Office-only access and outside-vendor intake

`Office Manager`, `Assistant Manager`, and `Office Staff` are office-only roles. They cannot open factory, workshop, artisan, warehouse, receipt or workspace-setting controls. Office Manager can grant and manage only `Office Staff` and `Assistant Manager` access; only Admin can manage every role and the complete system. Assistant Manager can create outside-vendor Office New Entries, while Office Staff retains the existing office code-entry actions.

Office New Entry creates office-only vendors/products, a permanent `OFFICE` journey, and one handwritten code per accepted product. The products enter Office Inventory in the same atomic save; the generated values are then written on their tags. TaraFabbs workshop products continue to enter through Factory Finished Goods Received. The Office panel shows only current office inventory, sold products, eligible office returns, and their office movement history. An outside-vendor `OFFICE` journey is enforced by the database and cannot enter workshop or artisan processing.

## Role self-service

Workshop staff share New Entry, handwritten code creation/confirmation, create-only company/product/Thanwala/artisan records, code recovery, stock counting and exception reporting. Receiving, Issue and Inspection retain their respective receiving, artist issue and inspection duties. Supervisor manages workshop master records and documented stock corrections. Creating a prerequisite does not grant permission to edit/archive shared masters.

Office Staff can confirm handwritten outside-vendor tag codes as well as receive workshop goods, sell and process eligible office returns. Assistant Manager and Office Manager can correct office-only vendor/product metadata and optional bill/date/notes on office entries within 24 hours. Office Manager continues to manage only Office Staff and Assistant Manager access. Office records cannot be edited through workshop master or intake operations.

Every profile includes My access; Admin Settings includes a role selector showing actual permissions. Ordinary staff may undo their own eligible code entry or artisan transaction within 20 minutes when the current version still matches. Office undo never restores workshop custody. First intake undo preserves the permanent code and restores pending-confirmation status for inspection again. Supervisor can reverse an unchanged artisan transaction after the staff window. Entry edits retain the 24-hour staff/Admin lifetime policy; unrestricted roles, settings and Data Control remain Admin-only.

Office Manager and Assistant Manager can also correct eligible office-team code confirmations, receipts and sales within the same 20-minute window. They cannot undo a workshop Send to Office or restore workshop custody.

Legacy Own Product lots missing a purchase Thanwala can be identified once by workshop staff using verified purchase evidence. Existing saved sources and permanent code identity cannot be replaced by this workflow. The assignment, office corrections and entry reversals all retain dated audit records.

Run `node scripts/test-role-access.mjs` and `node scripts/test-workshop-self-service.mjs` for local permission/handler checks without database writes.

Apply all migrations before deploying. Run the integration suites against a configured database with `node --env-file=.env scripts/test-barcode-recovery.mjs` and `node --env-file=.env scripts/test-office-access.mjs` (use your local environment filename). They exercise recovery, office permissions, outside-vendor label activation, sales, workshop isolation and immutable history inside rolled-back transactions.
