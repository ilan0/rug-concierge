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
};

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn("rounded-2xl border-border/70 shadow-sm", className)}>
      {(title || description || actions) && (
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              {title ? <CardTitle className="text-lg">{title}</CardTitle> : null}
              {description ? <CardDescription>{description}</CardDescription> : null}
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        </CardHeader>
      )}
      {children ? (
        <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
      ) : null}
    </Card>
  );
}
