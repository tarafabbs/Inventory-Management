# Inventory Management · IMS TARA MAA

The working application is available at:

**https://saree-ledger-akash.superkite128.chatgpt.site/**

It is private and requires ChatGPT sign-in. The first visit shows a sample preview; choose **Start your inventory** to set up real company, product, and artisan records. Demo records never enter the live ledger.

## Vercel link

This repository's Vercel deployment is a small entry point that redirects to the authenticated application above. `vercel.json` selects the static `vercel-entry` directory and applies a temporary 307 redirect, preserving paths and queries. The inventory server, authentication integration, and D1 database run on Sites / Cloudflare Workers; uploading a README or the application archive to Vercel does not deploy that server.

In Vercel, use this repository's root directory and the `main` production branch. The checked-in configuration supplies the static output directory and disables build/install commands. No Vercel environment variables are required for the redirect.

## Local application

The separately managed application checkout is in `saree-ledger/`. Its README documents local development, schema migrations, permissions, operating defaults, acceptance tests, and rollout checks. Its GitHub gitlink is not a configured submodule and does not embed the application source in this parent repository; the authoritative application source was pushed using the Sites source workflow.

The application includes receipts, Code 128 labels, label confirmation, saved scan drafts, handoffs, partial inspected returns, inventory and artisan balances, stock counts, exceptions, linked reversals/adjustments, staff roles, and CSV/print exports. It passed 19 workflow acceptance cases, four rule tests, type checking, a production build, and mobile/tablet scan-layout checks.
