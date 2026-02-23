import Link from "next/link";
import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { getServerUiRole } from "@/lib/ui/server-role";

type TradePageProps = {
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

export default async function TradePage({ searchParams }: TradePageProps) {
  const role = await getServerUiRole();
  if (role !== "trade_client" && role !== "store_staff") {
    return (
      <main className="ui-shell role-guard role-guard-blocked">
        <h1>Trade Support</h1>
        <p>This page is available only to trade clients and store staff.</p>
        <Link href="/">Go Home to switch role</Link>
      </main>
    );
  }

  const params = (await searchParams) ?? {};
  const debug = readString(params.debug) === "1";

  return (
    <>
      <div className="ui-nav concierge-nav">
        <Link href="/">Home</Link>
        <Link href="/concierge">Concierge</Link>
        {role === "store_staff" ? <Link href="/inventory">Inventory</Link> : null}
        <Link href={debug ? "/trade" : "/trade?debug=1"}>
          {debug ? "Debug Off" : "Debug On"}
        </Link>
      </div>
      <ConciergeScreen debug={debug} variant="trade" />
    </>
  );
}
