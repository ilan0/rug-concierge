# Role Capability Matrix (v1)

Backend policy source-of-truth reference.

Implementation modules:
- `apps/web/lib/auth/roles.ts`
- `apps/web/lib/auth/capabilities.ts`
- `apps/web/lib/auth/policy.ts`
- `apps/web/lib/auth/request-role.ts`

## Roles

- `retail_customer`
- `trade_client`
- `store_staff`
- `developer`

## Capabilities

- `chat.general`
- `chat.recommend`
- `chat.trade_support`
- `inventory.read`
- `appraisal.generate`
- `review.controls`
- `debug.trace.read`
- `debug.trace.capture`

## Capability Matrix

| Role | General Chat | Recommendations | Trade Support | Inventory | Appraisal | Review Controls | Debug Trace |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `retail_customer` | yes | yes | no | no | no | no | no |
| `trade_client` | yes | yes | yes | no | no | no | no |
| `store_staff` | yes | yes | yes | yes | yes | yes | no |
| `developer` | yes | yes | yes | yes | yes | yes | yes |

## UI Route Policy

- `/concierge` -> `chat.general`
- `/trade` -> `chat.trade_support`
- `/inventory` -> `inventory.read`
- `/appraisal` -> `appraisal.generate`

Home screen and workspace navigation use this same policy map for visibility.

## API Policy Notes

- Role resolution:
  - cookie role first
  - request role fallback
  - default role fallback (`retail_customer`)
- Cookie/request mismatch -> `403`.
- Privileged roles (`store_staff`, `developer`) require cookie-resolved role.
- `/api/chat` enforces mode-specific capabilities and review controls.
- `/api/recommend` enforces `chat.recommend`.
- `/api/appraisal/generate` enforces `appraisal.generate`.
- `/api/debug/trace` enforces `debug.trace.read`  
  - unauthorized returns `403` in development and `404` in production.
- `/api/ui-role` syncs the role cookie used for API role resolution.
