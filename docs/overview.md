Test data of rug listings from multiple REAL online rug stores:
https://docs.google.com/spreadsheets/d/1qc6GXLPLkBDNWGNJVQgwUNIeRQGL2M34xl8m7Mh5EjA/edit?gid=0#gid=0

Supabase (PostGres) 

1. Single DB + multi-tenant via tenant_id
2. RLS is used 
3. Every business-owned table includes tenant_id
    - rugs, images, clients, conversations, shortlists, etc.

Inventory design:

- Uploading a rug to inventory must be fast and easy
- Upload includes, photo(s), SKU, size, description (min: size + one liner)
- Enrichment options:
    1. Owner enrichment can be done later for an appraisal, designer needs, sale finalization.
    - POSSIBLY, async add photo enrichment via AI for rug details. Owner can accept/reject AI suggested fields.

Inventory Schema (mapped to each tenant):

- Customizable fields
- Optional fields for later enrichment
- Uses rugs and rug_images tables
- RLS is enabled so tenants have isolated control

Stack + design

- Frontend + Backend: **Next.js (App Router) + **TypeScript**
- Styling: **Tailwind CSS** + shadcn/ui (fast professional UI)
- Auth/DB/Storage: **Supabase**
- Hosting: **Vercel** (simplest for Next.js)
- One repo