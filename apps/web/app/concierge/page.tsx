import Link from "next/link";
import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { getServerUiRole } from "@/lib/ui/server-role";

type ConciergePageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function readString(
  value: string | string[] | undefined,
  fallback = ""
): string {
  if (typeof value === "string") return value;
  return fallback;
}

export default async function ConciergePage({ searchParams }: ConciergePageProps) {
  const role = await getServerUiRole();
  const params = (await searchParams) ?? {};
  const debug = readString(params.debug) === "1";

  return (
    <>
      <div className="concierge-nav">
        <Link href="/">Home</Link>
        {role === "store_staff" ? <Link href="/inventory">Inventory</Link> : null}
        {role === "store_staff" ? <Link href="/appraisal">Appraisal</Link> : null}
        <Link href={debug ? "/concierge" : "/concierge?debug=1"}>
          {debug ? "Debug Off" : "Debug On"}
        </Link>
      </div>
      <ConciergeScreen debug={debug} />
    </>
  );
}
