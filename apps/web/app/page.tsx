import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="home-hero">
        <p className="home-kicker">Rug Concierge</p>
        <h1>MVP Workspace</h1>
        <p>
          Use this app as your core UI shell for recommendation, chat, appraisal,
          and owner transparency workflows.
        </p>
      </section>

      <section className="home-grid">
        <Link href="/inventory" className="home-card">
          <h2>Inventory Browser</h2>
          <p>
            Read-only transparency screen for owner/staff trust review. This is
            the same inventory source used by recommendations.
          </p>
        </Link>
      </section>
    </main>
  );
}
