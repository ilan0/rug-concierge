import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  kicker?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  variant?: "default" | "setup" | "workflow" | "catalog" | "minimal";
};

const PAGE_HEADER_VARIANTS: Record<
  NonNullable<PageHeaderProps["variant"]>,
  {
    wrapper: string;
    content: string;
    kicker: string;
    title: string;
    subtitle: string;
    actions: string;
  }
> = {
  default: {
    wrapper:
      "mb-6 flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:flex-row sm:items-start sm:justify-between",
    content: "space-y-2",
    kicker: "text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground",
    title: "text-3xl font-semibold tracking-tight text-foreground",
    subtitle: "max-w-3xl text-base leading-7 text-muted-foreground",
    actions: "flex items-center gap-2",
  },
  setup: {
    wrapper:
      "mb-8 rounded-3xl border border-border/50 bg-card/70 px-6 py-7 text-center shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/65 sm:px-10 sm:py-9",
    content: "space-y-3",
    kicker: "text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground",
    title: "text-4xl font-semibold tracking-tight text-foreground sm:text-5xl",
    subtitle: "mx-auto max-w-3xl text-lg leading-8 text-foreground/85",
    actions: "mt-4 flex flex-wrap items-center justify-center gap-2",
  },
  workflow: {
    wrapper:
      "mb-6 flex flex-col gap-4 rounded-3xl border border-border/55 bg-card/72 p-5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/68 sm:p-6 lg:flex-row lg:items-start lg:justify-between",
    content: "space-y-2",
    kicker: "text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground",
    title: "text-[2rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[2.25rem]",
    subtitle: "max-w-3xl text-[1.05rem] leading-8 text-foreground/80",
    actions: "flex flex-wrap items-center gap-2",
  },
  catalog: {
    wrapper:
      "mb-5 flex flex-col gap-4 rounded-2xl border border-border/55 bg-card/75 p-5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70 md:flex-row md:items-end md:justify-between",
    content: "space-y-2",
    kicker: "text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground",
    title: "text-[1.95rem] font-semibold leading-tight tracking-tight text-foreground",
    subtitle: "max-w-3xl text-base leading-7 text-foreground/80",
    actions: "flex flex-wrap items-center gap-2",
  },
  minimal: {
    wrapper: "mb-5 flex flex-col gap-3",
    content: "space-y-1.5",
    kicker: "text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground",
    title: "text-2xl font-semibold tracking-tight text-foreground sm:text-3xl",
    subtitle: "max-w-2xl text-base leading-7 text-muted-foreground",
    actions: "flex items-center gap-2",
  },
};

export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
  className,
  variant = "default",
}: PageHeaderProps) {
  const header = PAGE_HEADER_VARIANTS[variant];
  return (
    <header
      className={cn(
        header.wrapper,
        className
      )}
    >
      <div className={header.content}>
        {kicker ? (
          <p className={header.kicker}>{kicker}</p>
        ) : null}
        <h1 className={header.title}>{title}</h1>
        {subtitle ? <p className={header.subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={header.actions}>{actions}</div> : null}
    </header>
  );
}
