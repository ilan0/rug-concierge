# Role Capability Matrix

Implementation references:
- `apps/web/lib/auth/roles.ts`
- `apps/web/lib/auth/capabilities.ts`
- `apps/web/lib/auth/request-role.ts`

## Roles

- `retail_customer`
- `store_staff`
- `developer`

## Capabilities

- `chat.general`
- `chat.recommend`
- `inventory.read`
- `inventory.intake`
- `debug.trace.read`
- `debug.trace.capture`

## Matrix

| Role | chat.general | chat.recommend | inventory.read | inventory.intake | debug.trace.read | debug.trace.capture |
| --- | --- | --- | --- | --- | --- | --- |
| `retail_customer` | yes | yes | no | no | no | no |
| `store_staff` | yes | yes | yes | yes | yes | yes |
| `developer` | yes | yes | yes | yes | yes | yes |

## Runtime Semantics

- Concierge UI defaults to retail behavior unless staff unlock is active.
- Staff cookie unlock controls page/API access for inventory/intake surfaces.
- `developer` request role is accepted only outside production (`NODE_ENV !== "production"`).
