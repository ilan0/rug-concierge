# Decisions

## Database
- Supabase (Postgres)
- Multi-tenant isolation: tenant_id on all tables + RLS

## Inventory intake
- Required: size + one-line intake_label
- Optional enrichment later (owner + AI suggestions)

## Deployment
- Next.js monorepo
- Hosting: Vercel