# Deployment Overview

This project runs as one deployment per store kiosk.

## Core Model

- deployment-scoped tenant via `TENANT_ID`
- customer-facing concierge always available
- staff actions gated by passcode + `staff_unlocked` cookie

## Canonical Ops Docs

Use these as the operational source of truth:
1. `docs/deployment/env-vars.md`
2. `docs/deployment/runbook.md`

This file is intentionally high-level; avoid duplicating runbook steps here.
