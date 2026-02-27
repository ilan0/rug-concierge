import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FormFieldProps = {
  label: string;
  htmlFor?: string;
  helper?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
};

export function FormField({
  label,
  htmlFor,
  helper,
  error,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!error && helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
    </div>
  );
}
