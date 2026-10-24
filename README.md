# Inventory Management · IMS TARA MAA

The application is a Next.js deployment designed to run directly on Vercel. It no longer redirects visitors to another application domain. Authentication uses Better Auth with Google OAuth, and the inventory database uses Turso/libSQL.

## Vercel configuration

Set these environment variables for Production and Preview:

- `BETTER_AUTH_SECRET`: a high-entropy random secret
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth web credentials
- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`: the persistent libSQL database
- `AUTH_ALLOWED_HOSTS`: comma-separated custom domains, without `https://`

Add this redirect URI to the Google OAuth web client:

`https://inventory-management-eight-ruby.vercel.app/api/auth/callback/google`

When a custom domain is attached, add its host to `AUTH_ALLOWED_HOSTS` and add its callback URI to Google, for example:

`https://inventory.example.com/api/auth/callback/google`

Run `npm run db:migrate` against the Turso environment before the first production deployment. The first Google account to open an empty application database becomes the Admin; later staff must be added by exact Google email under Settings.

## Local development

Copy `.env.example` to `.env.local`, fill in local credentials, then run `npm run db:migrate` and `npm run dev`. Without Turso variables, migrations and the app use `local.db` for development.

The application includes receipts, Code 128 labels, label confirmation, saved scan drafts, handoffs, partial inspected returns, inventory and artisan balances, stock counts, exceptions, linked reversals/adjustments, staff roles, and CSV/print exports. It passed 19 workflow acceptance cases, four rule tests, type checking, a production build, and mobile/tablet scan-layout checks.
