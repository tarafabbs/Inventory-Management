# Inventory Management · IMS TARA MAA

This is a Next.js application deployed on Vercel. It stays on the Vercel or custom domain and uses Supabase for Google authentication and PostgreSQL storage.

The inventory tables live in the dedicated `inventory` schema of the existing Tarafabbs Supabase project. This keeps the inventory `products` and `users` separate from the storefront tables in `public`. Database writes remain transactional, and PostgreSQL triggers protect immutable barcodes, custody rules, sequence numbers, and append-only history.

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

The application includes receipts, Code 128 labels, label confirmation, saved scan drafts, handoffs, partial inspected returns, inventory and artisan balances, stock counts, exceptions, linked reversals and adjustments, staff roles, and CSV/print exports.

## Barcode recovery

Barcode Recovery is available in Quick actions, the all-in-one scanner, Label center, Office and piece details. Staff can search valid registered pieces or pending labels by original code, bill, lot, company, product or artist. A replacement requires a reason, physical identification evidence and confirmation of an exact match. The original Code 128 value is reused; recovery never changes stock, custody, condition, intake confirmation or piece version.

Recovery requests persist until attachment is confirmed by scanning the replacement, or cancelled with a reason. Printer retries stay under the same request. Unidentified physical items can be reported separately and matched later; they cannot generate labels or stock. Closed records cannot be edited or deleted. Office Staff can only recover pieces within their Office scope. Viewer access cannot create recoveries.

The recovery screen also has a damaged-barcode reader beside the search form. It keeps trying a one-dimensional camera decode and accepts USB / Bluetooth scans or any readable code fragment. Fragment matching ignores spaces and hyphens, then marks results as exact, partial-code or record-detail matches before physical verification and replacement printing.

`Office Manager` is an operational manager role with access to all factory, artisan, warehouse, despatch, barcode-recovery and Office panels and actions. It can manage company, product, artisan and workspace settings. Staff account and role administration remains Admin-only.

Apply the `barcode_recovery` migration before deploying the feature. Run the integration suite against a configured database with `node --env-file=.env scripts/test-barcode-recovery.mjs` (use your local environment filename). It exercises search, permissions, replacements, retries, incorrect scans, pending intake, unidentified reports and immutable history inside one rolled-back transaction.
