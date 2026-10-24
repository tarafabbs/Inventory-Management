# Inventory Management · IMS TARA MAA

This is a Next.js application deployed on Vercel. It stays on the Vercel or custom domain and uses Supabase for Google authentication and PostgreSQL storage.

The inventory tables live in the dedicated `inventory` schema of the existing Tarafabbs Supabase project. This keeps the inventory `products` and `users` separate from the storefront tables in `public`. Database writes remain transactional, and PostgreSQL triggers protect immutable barcodes, custody rules, sequence numbers, and append-only history.

## Supabase configuration

The schema migration is stored in `supabase/migrations/20261024190000_inventory_schema.sql`.

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

Use the pooler URI on port `6543`; the server disables prepared statements for pooler compatibility. Keep `SUPABASE_DATABASE_URL` server-only.

## Local development

Copy `.env.example` to `.env.local`, fill in the Supabase values, and run:

```bash
npm run db:migrate
npm run dev
```

The application includes receipts, Code 128 labels, label confirmation, saved scan drafts, handoffs, partial inspected returns, inventory and artisan balances, stock counts, exceptions, linked reversals and adjustments, staff roles, and CSV/print exports.
