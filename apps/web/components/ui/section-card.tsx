import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SectionCardProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  density?: "roomy" | "compact";
  tone?: "default" | "soft" | "transparent";
};

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  density = "roomy",
  tone = "default",
}: SectionCardProps) {
  const densityClasses =
    density === "compact"
      ? {
          header: "space-y-1 pb-3 px-4 pt-4",
          content: "px-4 pb-4",
          title: "text-base",
        }
      : {
          header: "space-y-1 pb-4",
          content: "",
          title: "text-lg",
        };
  const toneClasses =
    tone === "soft"
      ? "border-border/55 bg-card/75 shadow-sm"
      : tone === "transparent"
        ? "border-border/35 bg-card/40 shadow-none backdrop-blur supports-[backdrop-filter]:bg-card/35"
        : "border-border/70 shadow-sm";

  return (
    <Card className={cn("rounded-2xl", toneClasses, className)}>
      {(title || description || actions) && (
        <CardHeader className={densityClasses.header}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              {title ? <CardTitle className={densityClasses.title}>{title}</CardTitle> : null}
              {description ? <CardDescription>{description}</CardDescription> : null}
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        </CardHeader>
      )}
      {children ? (
        <CardContent className={cn("pt-0", densityClasses.content, contentClassName)}>
          {children}
        </CardContent>
      ) : null}
    </Card>
  );
}
