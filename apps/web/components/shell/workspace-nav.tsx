import Link from "next/link";
import type { AppRole } from "@/lib/auth/roles";
import { canRoleAccessRoute, canRoleReadDebugTrace } from "@/lib/auth/policy";

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

export function WorkspaceNav(props: WorkspaceNavProps) {
  const role = props.role;
  const debugAllowed = role ? canRoleReadDebugTrace(role) : false;

  return (
    <nav className="ui-nav workspace-nav">
      <Link href="/">Home</Link>
      {WORKSPACE_LINKS.filter((link) => {
        if (link.href === "/concierge") return true;
        if (!role) return false;
        return canRoleAccessRoute(role, link.href);
      }).map((link) => (
        <Link
          href={link.href}
          key={link.href}
          data-active={props.currentPath === link.href ? "true" : "false"}
        >
          {link.label}
        </Link>
      ))}
      {props.debugToggle && debugAllowed ? (
        <Link
          href={props.debugToggle.enabled ? props.debugToggle.hrefOff : props.debugToggle.hrefOn}
        >
          {props.debugToggle.enabled ? "Debug Off" : "Debug On"}
        </Link>
      ) : null}
    </nav>
  );
}
