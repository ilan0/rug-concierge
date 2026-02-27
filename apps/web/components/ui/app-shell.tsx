import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  className?: string;
};

export function AppShell({ children, className }: AppShellProps) {
  return (
    <main
      className={cn(
        "mx-auto min-h-[calc(100vh-2rem)] w-full max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:px-8",
        className
      )}
    >
      {children}
    </main>
  );
}
