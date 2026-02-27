import Link from "next/link";
import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";

type AccessGuardProps = {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
};

export function AccessGuard({
  title,
  description,
  ctaLabel = "Go Home",
  ctaHref = "/",
}: AccessGuardProps) {
  return (
    <AppShell className="flex items-center">
      <SectionCard title={title} description={description} className="mx-auto w-full max-w-2xl">
        <Button asChild variant="secondary">
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      </SectionCard>
    </AppShell>
  );
}
