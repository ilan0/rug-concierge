import Link from "next/link";
import type { AppRole } from "@/lib/auth/roles";
import { canRoleAccessRoute, canRoleReadDebugTrace } from "@/lib/auth/policy";
import { cn } from "@/lib/utils";

type WorkspaceNavProps = {
  role: AppRole | null;
  currentPath: "/concierge" | "/trade" | "/inventory" | "/intake" | "/appraisal";
  variant?: "default" | "workspace-soft" | "concierge-minimal";
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
  { href: "/intake", label: "Intake" },
  { href: "/appraisal", label: "Appraisal" },
] as const;

function navLinkClass(
  active: boolean,
  variant: "default" | "workspace-soft" | "concierge-minimal"
): string {
  if (variant === "concierge-minimal") {
    return cn(
      "inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-sm font-medium leading-5 transition-colors",
      active
        ? "border-border/70 bg-background/75 text-foreground"
        : "border-border/20 bg-background/35 text-muted-foreground hover:border-border/40 hover:bg-background/60 hover:text-foreground"
    );
  }
  if (variant === "workspace-soft") {
    return cn(
      "inline-flex min-h-10 items-center rounded-full border px-3.5 py-1.5 text-[0.95rem] font-medium leading-5 transition-colors",
      active
        ? "border-border/70 bg-card/80 text-foreground shadow-sm"
        : "border-border/35 bg-background/45 text-foreground/75 hover:border-border/60 hover:bg-card/65 hover:text-foreground"
    );
  }
  return cn(
    "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium leading-5 transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card/70 text-foreground hover:bg-accent"
  );
}

export function WorkspaceNav(props: WorkspaceNavProps) {
  const role = props.role;
  const variant = props.variant ?? "default";
  const debugAllowed = role ? canRoleReadDebugTrace(role) : false;

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 sm:px-6 lg:px-8",
        variant === "concierge-minimal"
          ? "mt-2 opacity-95"
          : variant === "workspace-soft"
            ? "mt-3"
            : "mt-4"
      )}
    >
      <Link href="/" className={navLinkClass(false, variant)}>
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
          className={navLinkClass(props.currentPath === link.href, variant)}
        >
          {link.label}
        </Link>
      ))}
      {props.debugToggle && debugAllowed ? (
        <Link
          href={props.debugToggle.enabled ? props.debugToggle.hrefOff : props.debugToggle.hrefOn}
          className={cn(
            "ml-auto inline-flex items-center rounded-full border font-medium",
            variant === "concierge-minimal"
              ? "min-h-9 px-3 py-1.5 text-sm"
              : variant === "workspace-soft"
                ? "min-h-10 px-3.5 py-1.5 text-[0.95rem]"
              : "px-3 py-1.5 text-sm",
            props.debugToggle.enabled
              ? "border-amber-500/70 bg-amber-100/70 text-amber-900"
              : variant === "concierge-minimal"
                ? "border-border/40 bg-background/50 text-muted-foreground hover:text-foreground"
                : variant === "workspace-soft"
                  ? "border-border/45 bg-card/60 text-foreground/75 hover:text-foreground"
                : "border-border bg-card/70 hover:bg-accent"
          )}
        >
          {props.debugToggle.enabled ? "Debug On" : "Debug Off"}
        </Link>
      ) : null}
    </div>
  );
}
