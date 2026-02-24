"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { UiRole } from "@/lib/types/chat-ui";
import {
  clearUiRole,
  getUiRole,
  getUiTenantId,
  setUiTenantId,
  clearUiTenantId,
  setUiRole,
  syncRoleCookie,
  syncUiSession,
} from "@/lib/ui/role-session";
import { getAllowedRoutesForRole } from "@/lib/ui/role-permissions";
import { UI_ROLES, isUiRole, uiRoleLabel } from "@/lib/ui/roles";

const ROLE_SWITCHER_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER === "1" ||
  process.env.NODE_ENV !== "production";

const DEFAULT_PILOT_ROLE: UiRole = isUiRole(
  process.env.NEXT_PUBLIC_PILOT_DEFAULT_ROLE
)
  ? process.env.NEXT_PUBLIC_PILOT_DEFAULT_ROLE
  : "store_staff";

export function HomeScreen() {
  const [role, setRoleState] = useState<UiRole | null>(null);
  const [tenantId, setTenantState] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessVerified, setAccessVerified] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

  useEffect(() => {
    const storedRole = getUiRole();
    const storedTenant = getUiTenantId();
    if (storedRole) {
      setRoleState(storedRole);
    } else if (!ROLE_SWITCHER_ENABLED) {
      setRoleState(DEFAULT_PILOT_ROLE);
      setUiRole(DEFAULT_PILOT_ROLE);
    }
    if (storedTenant) {
      setTenantState(storedTenant);
    }

    void fetch("/api/ui-access")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { required?: boolean; verified?: boolean }
          | null;
        setAccessRequired(Boolean(payload?.required));
        setAccessVerified(Boolean(payload?.verified));
      })
      .catch(() => {
        setAccessRequired(false);
        setAccessVerified(true);
      })
      .finally(() => {
        setAccessLoading(false);
      });
  }, []);

  const cards = useMemo(
    () => (role && tenantId.trim() ? getAllowedRoutesForRole(role) : []),
    [role, tenantId]
  );

  const syncRoleAndTenant = async (
    nextRole: UiRole | null,
    nextTenantId: string
  ): Promise<void> => {
    const normalizedTenant = nextTenantId.trim();
    if (!normalizedTenant) {
      setError("Enter Tenant ID first to continue.");
      return;
    }
    setError(null);
    setIsSyncing(true);
    if (nextRole) {
      setUiRole(nextRole);
    }
    setUiTenantId(normalizedTenant);
    try {
      await syncUiSession({
        role: nextRole,
        tenant_id: normalizedTenant,
      });
    } catch {
      setError("Saved locally, but failed to sync role/tenant session cookies.");
    } finally {
      setIsSyncing(false);
    }
  };

  const chooseRole = async (nextRole: UiRole) => {
    setRoleState(nextRole);
    await syncRoleAndTenant(nextRole, tenantId);
  };

  const clearRole = async () => {
    setRoleState(null);
    setError(null);
    clearUiRole();
    setIsSyncing(true);
    try {
      await syncUiSession({
        role: null,
        tenant_id: tenantId.trim() || null,
      });
    } catch {
      setError("Failed to clear server role cookie.");
    } finally {
      setIsSyncing(false);
    }
  };

  const saveTenant = async () => {
    if (!tenantId.trim()) {
      setError("Enter Tenant ID first to continue.");
      return;
    }
    if (!role) {
      setUiTenantId(tenantId.trim());
      setError("Tenant saved locally. Select role next.");
      return;
    }
    await syncRoleAndTenant(role, tenantId);
  };

  const clearTenant = async () => {
    setTenantState("");
    clearUiTenantId();
    setError(null);
    setIsSyncing(true);
    try {
      if (role) {
        await syncUiSession({
          role,
          tenant_id: null,
        });
      } else {
        await syncRoleCookie(null);
      }
    } catch {
      setError("Failed to clear tenant cookie.");
    } finally {
      setIsSyncing(false);
    }
  };

  const submitPasscode = async () => {
    if (!passcode.trim()) {
      setPasscodeError("Enter the access code.");
      return;
    }
    setPasscodeError(null);
    setIsSyncing(true);
    try {
      const response = await fetch("/api/ui-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passcode }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { verified?: boolean; error?: string }
        | null;
      if (!response.ok || !payload?.verified) {
        setPasscodeError(payload?.error ?? "Invalid access code.");
        return;
      }
      setAccessVerified(true);
      setPasscode("");
    } catch {
      setPasscodeError("Access verification failed. Try again.");
    } finally {
      setIsSyncing(false);
    }
  };

  if (accessLoading) {
    return (
      <main className="ui-shell ui-showroom home-page home-showroom">
        <section className="ui-card home-role-panel">
          <h2>Preparing workspace...</h2>
          <p>Loading pilot access status.</p>
        </section>
      </main>
    );
  }

  if (accessRequired && !accessVerified) {
    return (
      <main className="ui-shell ui-showroom home-page home-showroom">
        <section className="home-hero">
          <p className="ui-kicker home-kicker">Rug Concierge</p>
          <h1>Pilot Access</h1>
          <p className="ui-subtitle">
            Enter your owner pilot access code to continue.
          </p>
        </section>
        <section className="home-role-panel ui-card">
          <label>
            Access Code
            <input
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              placeholder="Enter code"
            />
          </label>
          <div className="home-role-buttons">
            <button
              type="button"
              className="home-role-btn ui-btn active"
              onClick={() => void submitPasscode()}
              disabled={isSyncing}
            >
              {isSyncing ? "Verifying..." : "Unlock Pilot"}
            </button>
          </div>
          {passcodeError ? <p className="home-role-error">{passcodeError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="ui-shell ui-showroom home-page home-showroom">
      <section className="home-hero">
        <p className="ui-kicker home-kicker">Rug Concierge</p>
        <h1>MVP Workspace</h1>
        <p className="ui-subtitle">
          Select store tenant and role. The app then shows only pages relevant to that role.
        </p>
      </section>

      <section className="home-role-panel ui-card">
        <div>
          <h2>{ROLE_SWITCHER_ENABLED ? "Select Role + Store" : "Pilot Setup"}</h2>
          <p>
            Current role: <strong>{role ? uiRoleLabel(role) : "Not selected"}</strong>
          </p>
          <p>
            Tenant ID: <strong>{tenantId.trim() || "Not set"}</strong>
          </p>
        </div>
        <label>
          Store Tenant ID
          <input
            value={tenantId}
            onChange={(event) => setTenantState(event.target.value)}
            placeholder="tenant UUID"
          />
        </label>
        <div className="home-role-buttons">
          <button
            type="button"
            className="home-role-btn ui-btn"
            onClick={() => void saveTenant()}
            disabled={isSyncing}
          >
            Save Store
          </button>
          <button
            type="button"
            className="home-role-btn ui-btn ghost"
            onClick={() => void clearTenant()}
            disabled={isSyncing}
          >
            Clear Store
          </button>
        </div>
        {ROLE_SWITCHER_ENABLED ? (
          <div className="home-role-buttons">
            {UI_ROLES.map((roleOption) => (
              <button
                key={roleOption}
                type="button"
                className={
                  role === roleOption ? "home-role-btn ui-btn active" : "home-role-btn ui-btn"
                }
                onClick={() => chooseRole(roleOption)}
                disabled={isSyncing || !tenantId.trim()}
              >
                {uiRoleLabel(roleOption)}
              </button>
            ))}
            <button type="button" className="home-role-btn ui-btn ghost" onClick={clearRole}>
              Clear Role
            </button>
          </div>
        ) : (
          <p className="home-role-helper">
            Role switching is hidden in pilot mode for a simpler owner experience.
          </p>
        )}
        {error ? <p className="home-role-error">{error}</p> : null}
      </section>

      <section className="home-grid">
        {cards.length === 0 ? (
          <article className="home-card ui-card home-card-muted">
            <h2>No pages yet</h2>
            <p>Set tenant + role to unlock your workspace routes.</p>
          </article>
        ) : (
          cards.map((card) => (
            <Link href={card.href} className="home-card ui-card" key={card.href}>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
