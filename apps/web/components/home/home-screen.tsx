"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { UiRole } from "@/lib/types/chat-ui";
import {
  clearUiRole,
  getUiRole,
  setUiRole,
  syncRoleCookie,
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedRole = getUiRole();
    if (storedRole) {
      setRoleState(storedRole);
      return;
    }

    if (!ROLE_SWITCHER_ENABLED) {
      const nextRole = DEFAULT_PILOT_ROLE;
      setRoleState(nextRole);
      setIsSyncing(true);
      setUiRole(nextRole);
      void syncRoleCookie(nextRole)
        .catch(() => {
          setError("Unable to initialize pilot role on this device.");
        })
        .finally(() => {
          setIsSyncing(false);
        });
      return;
    }

    setRoleState(null);
  }, []);

  const cards = useMemo(() => (role ? getAllowedRoutesForRole(role) : []), [role]);

  const chooseRole = async (nextRole: UiRole) => {
    setError(null);
    setRoleState(nextRole);
    setUiRole(nextRole);
    setIsSyncing(true);
    try {
      await syncRoleCookie(nextRole);
    } catch {
      setError("Saved locally, but failed to sync server role cookie.");
    } finally {
      setIsSyncing(false);
    }
  };

  const clearRole = async () => {
    setRoleState(null);
    setError(null);
    clearUiRole();
    setIsSyncing(true);
    try {
      await syncRoleCookie(null);
    } catch {
      setError("Failed to clear server role cookie.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <main className="ui-shell ui-showroom home-page home-showroom">
      <section className="home-hero">
        <p className="ui-kicker home-kicker">Rug Concierge</p>
        <h1>MVP Workspace</h1>
        <p className="ui-subtitle">
          Select your role first. The app then shows only the pages relevant to that role.
        </p>
      </section>

      <section className="home-role-panel ui-card">
        <div>
          <h2>{ROLE_SWITCHER_ENABLED ? "Select Role" : "Pilot Role"}</h2>
          <p>
            Current role: <strong>{role ? uiRoleLabel(role) : "Not selected"}</strong>
          </p>
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
                disabled={isSyncing}
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
            <p>Choose a role to unlock your workspace routes.</p>
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
