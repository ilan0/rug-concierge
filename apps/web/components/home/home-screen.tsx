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
import { UI_ROLES, uiRoleLabel } from "@/lib/ui/roles";

export function HomeScreen() {
  const [role, setRoleState] = useState<UiRole | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRoleState(getUiRole());
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
    <main className="home-page home-showroom">
      <section className="home-hero">
        <p className="home-kicker">Rug Concierge</p>
        <h1>MVP Workspace</h1>
        <p>
          Select your role first. The app then shows only the pages relevant to that role.
        </p>
      </section>

      <section className="home-role-panel">
        <div>
          <h2>Select Role</h2>
          <p>
            Current role: <strong>{role ? uiRoleLabel(role) : "Not selected"}</strong>
          </p>
        </div>
        <div className="home-role-buttons">
          {UI_ROLES.map((roleOption) => (
            <button
              key={roleOption}
              type="button"
              className={role === roleOption ? "home-role-btn active" : "home-role-btn"}
              onClick={() => chooseRole(roleOption)}
              disabled={isSyncing}
            >
              {uiRoleLabel(roleOption)}
            </button>
          ))}
          <button type="button" className="home-role-btn ghost" onClick={clearRole}>
            Clear Role
          </button>
        </div>
        {error ? <p className="home-role-error">{error}</p> : null}
      </section>

      <section className="home-grid">
        {cards.length === 0 ? (
          <article className="home-card home-card-muted">
            <h2>No pages yet</h2>
            <p>Choose a role to unlock your workspace routes.</p>
          </article>
        ) : (
          cards.map((card) => (
            <Link href={card.href} className="home-card" key={card.href}>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
