import Link from "next/link";
import { AppraisalScreen } from "@/components/appraisal/appraisal-screen";
import { getServerUiRole } from "@/lib/ui/server-role";

export default async function AppraisalPage() {
  const role = await getServerUiRole();
  if (role !== "store_staff") {
    return (
      <main className="ui-shell role-guard role-guard-blocked">
        <h1>Appraisal Draft Studio</h1>
        <p>This page is available only to store staff.</p>
        <Link href="/">Go Home to switch role</Link>
      </main>
    );
  }

  return (
    <>
      <nav className="ui-nav appraisal-nav">
        <Link href="/">Back Home</Link>
        <Link href="/concierge">Open Concierge</Link>
      </nav>
      <AppraisalScreen />
    </>
  );
}
