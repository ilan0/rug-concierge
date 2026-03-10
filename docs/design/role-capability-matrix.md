# Role Capability Matrix

Implementation references:
- `apps/web/lib/auth/roles.ts`
- `apps/web/lib/auth/capabilities.ts`
- `apps/web/lib/auth/policy.ts`

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

## Route Policy

- `/concierge` -> `chat.general`
- `/inventory` -> `inventory.read`
- `/intake` -> `inventory.intake`

## Runtime Semantics

- open mode: customer behavior by default
- passcode mode with valid device cookie: staff behavior
- developer mode is local/dev-only; no production grant path
