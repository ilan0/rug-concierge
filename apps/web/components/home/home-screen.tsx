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
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const ROLE_SWITCHER_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER === "1" ||
  process.env.NODE_ENV !== "production";
const DEPLOYMENT_TYPE = process.env.NEXT_PUBLIC_DEPLOYMENT_TYPE;

const DEFAULT_PILOT_ROLE: UiRole = isUiRole(
  process.env.NEXT_PUBLIC_PILOT_DEFAULT_ROLE
)
  ? process.env.NEXT_PUBLIC_PILOT_DEFAULT_ROLE
  : "store_staff";
const ENV_TENANT_ID =
  typeof process.env.NEXT_PUBLIC_TENANT_ID === "string" &&
  process.env.NEXT_PUBLIC_TENANT_ID.trim().length > 0
    ? process.env.NEXT_PUBLIC_TENANT_ID.trim()
    : "";

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
    const initialRole = storedRole
      ? storedRole
      : !ROLE_SWITCHER_ENABLED
        ? DEFAULT_PILOT_ROLE
        : null;

    if (storedRole) {
      setRoleState(storedRole);
    } else if (!ROLE_SWITCHER_ENABLED) {
      setRoleState(DEFAULT_PILOT_ROLE);
      setUiRole(DEFAULT_PILOT_ROLE);
    }
    const initialTenant = storedTenant || ENV_TENANT_ID;
    if (initialTenant) {
      setTenantState(initialTenant);
      setUiTenantId(initialTenant);
      if (initialRole) {
        void syncUiSession({
          role: initialRole,
          tenant_id: initialTenant,
        }).catch(() => {
          // Keep local setup usable even if cookie sync fails.
        });
      }
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
      if (DEPLOYMENT_TYPE === "staff") {
        window.location.assign("/");
      }
    } catch {
      setPasscodeError("Access verification failed. Try again.");
    } finally {
      setIsSyncing(false);
    }
  };

  if (accessLoading) {
    return (
      <AppShell variant="setup">
        <SectionCard
          title="Preparing workspace"
          description="Loading pilot access status."
          tone="soft"
          density="compact"
        />
      </AppShell>
    );
  }

  if (accessRequired && !accessVerified) {
    return (
      <AppShell variant="setup">
        <PageHeader
          kicker="Rug Concierge"
          title="Pilot Access"
          subtitle="Enter your owner pilot access code to continue."
          variant="setup"
        />
        <SectionCard
          title="Unlock Pilot"
          description="Access code is required for hosted pilot mode."
          tone="soft"
          className="mx-auto w-full max-w-3xl"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="access-code">Access Code</Label>
              <Input
                id="access-code"
                type="password"
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                placeholder="Enter code"
              />
            </div>
            <Button
              type="button"
              onClick={() => void submitPasscode()}
              disabled={isSyncing}
            >
              {isSyncing ? "Verifying..." : "Unlock Pilot"}
            </Button>
            {passcodeError ? (
              <Alert variant="destructive">
                <AlertTitle>Access failed</AlertTitle>
                <AlertDescription>{passcodeError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </SectionCard>
      </AppShell>
    );
  }

  return (
    <AppShell variant="setup">
      <PageHeader
        kicker="Rug Concierge"
        title="MVP Workspace"
        subtitle="Select your store tenant and role to open only the pages your role can use."
        variant="setup"
      />

      <div className="mx-auto w-full max-w-4xl space-y-5">
        <SectionCard
          title={ROLE_SWITCHER_ENABLED ? "Select Role + Store" : "Pilot Setup"}
          tone="soft"
          className="border-border/55"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Role: {role ? uiRoleLabel(role) : "Not selected"}</Badge>
              <Badge variant="outline">Tenant: {tenantId.trim() || "Not set"}</Badge>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenant-id">Store Tenant ID</Label>
              <Input
                id="tenant-id"
                value={tenantId}
                onChange={(event) => setTenantState(event.target.value)}
                placeholder="Paste tenant UUID"
                className="h-11 text-base"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void saveTenant()}
                  disabled={isSyncing}
                  className="h-11 px-5 text-base"
                >
                  Save Tenant
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void clearTenant()}
                  disabled={isSyncing}
                  className="h-11 px-5 text-base"
                >
                  Clear Tenant
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Role</p>
              <div className="flex flex-wrap gap-2">
                {roleOptions().map((candidate) => (
                  <Button
                    key={candidate}
                    type="button"
                    variant={role === candidate ? "default" : "outline"}
                    onClick={() => void chooseRole(candidate)}
                    disabled={isSyncing}
                    className="h-11 px-5 text-base"
                  >
                    {uiRoleLabel(candidate)}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void clearRole()}
                  disabled={isSyncing}
                  className="h-11 px-5 text-base"
                >
                  Clear Role
                </Button>
              </div>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Update issue</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Workspace Pages"
          description="Available pages for the selected role."
          tone="soft"
          className="border-border/55"
        >
          {cards.length === 0 ? (
            <p className="text-base text-muted-foreground">
              Set role and tenant to unlock pages.
            </p>
          ) : (
            <div className="grid gap-3">
              {cards.map((card) => (
                <Link
                  key={card.href}
                  href={card.href}
                  className="rounded-2xl border border-border/65 bg-background/70 p-5 transition hover:bg-accent/40"
                >
                  <p className="text-lg font-semibold">{card.title}</p>
                  <p className="mt-1 text-base leading-7 text-muted-foreground">{card.description}</p>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}

function roleOptions(): UiRole[] {
  if (!ROLE_SWITCHER_ENABLED) return [DEFAULT_PILOT_ROLE];
  return UI_ROLES;
}
