# Trade Client Preferences (v1 – Minimal)

This document describes how trade client preferences are stored and used for personalization.
It intentionally avoids rigid rules so the system can evolve without schema changes.

---

## What “Preferences” Are

Preferences are **soft signals**, not hard rules.

They help the assistant:
- rank rugs more intelligently
- reduce repetitive questions
- personalize tone and suggestions

They do **not** enforce pricing, availability, or discounts.

---

## Where Preferences Live

### Trade client–specific
Stored per trade client in: trade_clients.preferences
These describe what a specific designer or trade buyer usually likes or avoids.

### Tenant defaults (optional)
A store may define general trade defaults in: tenants.settings.trade_defaults
If a trade client has no explicit preferences, tenant defaults may be used instead.

---

## Preference Shape

Preferences are stored as **JSON**.

There is **no required schema**, but the system may recognize common keys such as:
- budgets
- styles
- colors / palettes
- sizes
- room types
- practical constraints (pets, kids, lead time)
- communication or output preferences

Unknown keys are allowed and safely ignored.

---

## How Preferences Are Used

When interacting with a trade client:
1. Start with tenant defaults (if any)
2. Overlay client-specific preferences
3. Use the result to guide filtering, ranking, and phrasing

Client preferences always override tenant defaults.

---

## AI Behavior Rules

- The AI may reference a preference **only if it exists**
- The AI must never infer or invent preferences
- Preferences influence recommendations, not guarantees

Example allowed:
> “Based on your usual preference for muted tones…”

Example not allowed:
> “You typically prefer silk rugs” (unless explicitly stored)

---

## Design Intent

Preferences exist to:
- support personalization
- preserve flexibility
- avoid per-client or per-tenant schema changes

This document defines a **minimal contract**, not a final design.