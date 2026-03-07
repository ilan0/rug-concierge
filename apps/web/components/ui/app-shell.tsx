import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  className?: string;
  variant?: "default" | "setup" | "conversational" | "workflow" | "catalog";
};

const APP_SHELL_VARIANT_CLASS: Record<NonNullable<AppShellProps["variant"]>, string> = {
  default: "max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:px-8",
  setup: "max-w-5xl px-4 pb-12 pt-8 sm:px-6 lg:px-8",
  conversational: "max-w-5xl px-4 pb-8 pt-4 sm:px-6 lg:px-8",
  workflow: "max-w-[1220px] px-4 pb-10 pt-6 sm:px-6 lg:px-8",
  catalog: "max-w-[1320px] px-4 pb-10 pt-6 sm:px-6 lg:px-8",
};

export function AppShell({ children, className, variant = "default" }: AppShellProps) {
  return (
    <main
      className={cn(
        "mx-auto min-h-[calc(100vh-2rem)] w-full",
        APP_SHELL_VARIANT_CLASS[variant],
        className
      )}
    >
      {children}
    </main>
  );
}
