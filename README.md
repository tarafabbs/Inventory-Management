# IMS TARA MAA

Quantity-based workshop and Office stock management on Next.js, Vercel and Supabase. The approved business rules are in [PRODUCTION_REQUIREMENTS.md](PRODUCTION_REQUIREMENTS.md).

## Current workflow

- Company/category aggregate stock. No barcode, handwritten product code or challan-wise return matching.
- Raw → artisan → Ready to Dispatch; additional artwork and internal reprint move the same physical quantity between accounts.
- Company Return has its own separate repair inventory and dispatch flow.
- Date identifies bills in the interface; bill/GST number is optional. A bill and its dispatch post atomically.
- Company Khata records bill totals, unallocated payments and due/advance. Damage adjustments are explicit.
- Opening balances cover stock locations, artist pending, company-held goods, Office stock, prior due/advance and unsettled damage.
- Mobile bottom navigation, desktop sidebar, company profiles, artisan profiles, full-history search/export and Fix Issues.

The `inventory` schema is separate from the storefront's `public` schema. Production tables are private, have RLS enabled and do not grant browser roles direct access. Writes use a server-verified approved Google identity and current staff role.

## Access

Only Owner can manage staff access and delete/reverse/reset quantities. Management has operational control. Office Staff receives Own Product sent from the workshop; Office managers can also handle outside-vendor intake. Approved Google emails must already be listed by the Owner; first sign-in never creates an Owner automatically.

## Opening balances

Open **Menu → Opening Balance** using Owner/Management access. Choose the opening date, company, category and stock location. Add artist/work when opening artist-held stock. Enter each account once, review and confirm. Artist stock is automatically included in its company totals.

Financial opening: positive amount means company due; negative means advance/credit. Leave blank when opening stock only. Open all starting locations before entering normal movements for that category. Previously dispatched goods still with a company can be opened as **With Company** to permit later aggregate returns.

## Development

Required server-only connection: `SUPABASE_DATABASE_URL` (or `POSTGRES_URL` / `DATABASE_URL`). Public configuration: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Keep credentials outside Git.

```sh
npm run dev
npm run typecheck
npm run build
node scripts/test-production.mjs
node scripts/test-role-access.mjs
```

The database integration test requires a database connection and rolls back all fixtures:

```sh
node --env-file=.env scripts/test-production-api.mjs
```

Migrations live in `supabase/migrations`. On an existing project, inspect its applied Supabase migration history and apply only unapplied migrations. Never reset the live database or replay historical schema files. The production-accounts migration was applied once; old quantities/history remain archived and the old quantity-write path is protected against stale tabs.

Google callback: `https://im.tarafabbs.com/auth/callback`. Existing approved-email Google sign-in remains unchanged. `/archive` provides previous history; use current production screens for new entries.

AI assistant work is paused and excluded from the published inventory commits.
