import Link from "next/link";
import type { AppRole } from "@/lib/auth/roles";
import { canRoleAccessRoute, canRoleReadDebugTrace } from "@/lib/auth/policy";
import { cn } from "@/lib/utils";

type WorkspaceNavProps = {
  role: AppRole | null;
  currentPath: "/concierge" | "/trade" | "/inventory" | "/appraisal";
  debugToggle?: {
    enabled: boolean;
    hrefOn: string;
    hrefOff: string;
  };
};

const WORKSPACE_LINKS = [
  { href: "/concierge", label: "Concierge" },
  { href: "/trade", label: "Trade" },
  { href: "/inventory", label: "Inventory" },
  { href: "/appraisal", label: "Appraisal" },
] as const;

function navLinkClass(active: boolean): string {
  return cn(
    "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card/70 text-foreground hover:bg-accent"
  );
}

export function WorkspaceNav(props: WorkspaceNavProps) {
  const role = props.role;
  const debugAllowed = role ? canRoleReadDebugTrace(role) : false;

  return (
    <div className="mx-auto mt-4 flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 sm:px-6 lg:px-8">
      <Link href="/" className={navLinkClass(false)}>
        Home
      </Link>
      {WORKSPACE_LINKS.filter((link) => {
        if (link.href === "/concierge") return true;
        if (!role) return false;
        return canRoleAccessRoute(role, link.href);
      }).map((link) => (
        <Link
          href={link.href}
          key={link.href}
          className={navLinkClass(props.currentPath === link.href)}
        >
          {link.label}
        </Link>
      ))}
      {props.debugToggle && debugAllowed ? (
        <Link
          href={props.debugToggle.enabled ? props.debugToggle.hrefOff : props.debugToggle.hrefOn}
          className={cn(
            "ml-auto inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium",
            props.debugToggle.enabled
              ? "border-amber-500 bg-amber-100 text-amber-900"
              : "border-border bg-card/70 hover:bg-accent"
          )}
        >
          {props.debugToggle.enabled ? "Debug On" : "Debug Off"}
        </Link>
      ) : null}
    </div>
  );
}
