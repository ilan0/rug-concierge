import Image from "next/image";
import { ContactForm } from "./contact-form";

const proofPoints = [
  {
    title: "Show the right rugs online",
    copy: "Help website visitors narrow down choices instead of leaving after a few photos.",
  },
  {
    title: "See who is serious",
    copy: "Know which shoppers saved rugs, asked questions, or want to keep talking.",
  },
  {
    title: "Book showroom visits",
    copy: "Give interested customers an easier way to ask for a private in-store showing.",
  },
  {
    title: "Digitize inventory faster",
    copy: "Turn rough rug photos into cleaner inventory so your website can show real rugs.",
  },
];

const salesmanMoments = [
  {
    label: "Customer asks",
    copy: "I want a warm Persian rug for a living room and I do not want to start from scratch.",
  },
  {
    label: "Rugdesk responds",
    copy: "Rugdesk shows matching rugs, keeps favorites organized, and helps the customer keep moving.",
  },
  {
    label: "Store stays informed",
    copy: "Your team sees the interest clearly and knows when to follow up or invite them in.",
  },
];

const howItWorks = [
  {
    title: "A shopper lands on your website",
    copy: "Instead of guessing from a few static photos, they can describe what they want and start browsing with direction.",
  },
  {
    title: "Rugdesk helps them narrow it down",
    copy: "They save rugs they like, ask for a visit, or leave clear signs that they are interested in specific pieces.",
  },
  {
    title: "Your staff gets a real next step",
    copy: "You can follow up on serious interest, prepare rugs for an appointment, and keep the sales process organized.",
  },
];

const faqs = [
  {
    question: "Do I need a perfect online catalog first?",
    answer:
      "No. Many rug stores do not have a clean online inventory today. Rugdesk helps digitize real in-store inventory faster so the website can show better options without rebuilding everything by hand.",
  },
  {
    question: "Is Rugdesk trying to replace my sales staff?",
    answer:
      "No. Your staff still handles trust, pricing, and closing the sale. Rugdesk helps start the conversation online, organize customer interest, and make follow-up easier.",
  },
  {
    question: "Can this help bring people into the gallery?",
    answer:
      "Yes. A shopper can find rugs online first and then request a showroom visit when they want to see pieces in person.",
  },
  {
    question: "Will this be too technical for my store to manage?",
    answer:
      "That is exactly what we want to avoid. The site language, staff flow, and inventory intake are meant to stay practical and simple for real rug stores.",
  },
];

export default function HomePage() {
  return (
    <main className="site-page">
      <header className="site-header">
        <div className="container header-inner">
          <a className="wordmark" href="#top" aria-label="Rugdesk home">
            Rugdesk
          </a>

          <nav className="header-nav" aria-label="Primary">
            <a className="nav-link" href="#how-it-works">
              How it works
            </a>
            <a className="nav-link" href="#contact">
              Contact
            </a>
            <a
              className="button button-primary header-cta"
              href="https://demo.rugdesk.app"
              target="_blank"
              rel="noreferrer"
            >
              Try live demo
            </a>
          </nav>
        </div>
      </header>

      <section className="hero-section" id="top">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">For premium rug stores</p>
            <h1>Turn website visitors into real rug customers.</h1>
            <p className="hero-lead">
              Rugdesk acts like a digital rug salesman on your website. It helps shoppers find rugs they like,
              save favorites, request a visit, and gives your staff a clear next step.
            </p>

            <div className="hero-actions">
              <a
                className="button button-primary"
                href="https://demo.rugdesk.app"
                target="_blank"
                rel="noreferrer"
              >
                Try live demo
              </a>
              <a className="button button-secondary" href="#contact">
                Contact Rugdesk
              </a>
            </div>

            <ul className="hero-badges" aria-label="Key benefits">
              <li>Help serious shoppers faster</li>
              <li>Book more showroom visits</li>
              <li>Keep staff follow-up clear</li>
            </ul>
          </div>

          <figure className="hero-media-frame">
            <div className="hero-media-shell hero-motion-slot">
              <Image
                src="/media/hero/hero-online-leads.webp"
                alt="A refined home setting with a laptop showing Rugdesk helping an online shopper find matching rugs."
                width={1536}
                height={1024}
                className="hero-media"
                priority
                sizes="(max-width: 900px) 100vw, 52vw"
              />
              <div className="hero-floating-card hero-floating-card-top">Website visitor asks for help</div>
              <div className="hero-floating-card hero-floating-card-bottom">Rugdesk recommends rugs and keeps interest organized</div>
            </div>
            <figcaption className="hero-caption">
              A calmer online shopping experience for premium rug stores.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="proof-section">
        <div className="container proof-grid">
          {proofPoints.map((point) => (
            <article className="proof-card" key={point.title}>
              <p className="proof-kicker">Business result</p>
              <h2>{point.title}</h2>
              <p>{point.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block" id="salesman">
        <div className="container feature-grid feature-grid-lead">
          <div className="feature-copy feature-copy-wide">
            <p className="eyebrow">A digital rug salesman</p>
            <h2>Let your website do more than show a few random rug photos.</h2>
            <p>
              Many rug store websites do not turn interest into real conversations. Rugdesk gives shoppers a simpler
              way to explain what they want and keep moving toward the right rugs.
            </p>
            <ul className="feature-list">
              <li>Guide visitors without making them call just to get started.</li>
              <li>Keep the online experience warm, clear, and premium.</li>
              <li>Help your store stand apart from generic online rug listings.</li>
            </ul>
          </div>

          <div className="salesman-panel" aria-label="How Rugdesk helps website visitors become customer inquiries">
            {salesmanMoments.map((item) => (
              <article className="salesman-row" key={item.label}>
                <p className="salesman-label">{item.label}</p>
                <p>{item.copy}</p>
              </article>
            ))}
            <div className="salesman-outcome">
              <span className="salesman-outcome-dot" aria-hidden="true" />
              The result: clearer customer interest, fewer lost shoppers, and a better first conversation.
            </div>
          </div>
        </div>
      </section>

      <section className="section-block section-light">
        <div className="container feature-grid">
          <div className="feature-copy">
            <p className="eyebrow">Customers save rugs they like</p>
            <h2>Do not let interested shoppers forget what they found.</h2>
            <p>
              When someone finds rugs they like, Rugdesk helps keep that interest organized. That makes it easier for a
              shopper to come back, ask for help, or continue the conversation later.
            </p>
            <ul className="feature-list">
              <li>Saved rugs give the customer a simple shortlist.</li>
              <li>Your store can see real interest instead of guessing.</li>
              <li>The experience still feels premium, not like a discount shopping app.</li>
            </ul>
          </div>

          <figure className="media-card media-card-feature">
            <Image
              src="/media/product/customer-interest.webp"
              alt="Premium rug recommendation cards with saved states and a clear signal that the shopper is interested."
              width={1536}
              height={1024}
              sizes="(max-width: 900px) 100vw, 48vw"
            loading="eager"
            />
          </figure>
        </div>
      </section>

      <section className="section-block section-warm">
        <div className="container feature-grid feature-grid-reverse">
          <figure className="media-card media-card-feature">
            <Image
              src="/media/product/appointment-booking.webp"
              alt="A premium booking view showing a shopper requesting a private showroom appointment for specific rugs."
              width={1536}
              height={1024}
              sizes="(max-width: 900px) 100vw, 48vw"
            loading="eager"
            />
          </figure>

          <div className="feature-copy">
            <p className="eyebrow">Book a showroom visit</p>
            <h2>Bring the right online shoppers into the gallery.</h2>
            <p>
              Some customers want to come in once they have narrowed things down. Rugdesk can help turn online browsing
              into a private showroom visit instead of another dead end on the website.
            </p>
            <ul className="feature-list feature-list-success">
              <li>Connect online interest to a real in-store appointment.</li>
              <li>Let staff prepare the right rugs before the customer arrives.</li>
              <li>Make the gallery visit feel more personal and better informed.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="container feature-grid">
          <div className="feature-copy">
            <p className="eyebrow">Clear staff follow-up</p>
            <h2>Show your team who is interested and what to do next.</h2>
            <p>
              Good follow-up should not depend on memory. Rugdesk makes it easier for your staff to see who reached
              out, which rugs they liked, and where the next conversation should start.
            </p>
            <ul className="feature-list">
              <li>See the customer and the rugs together in one view.</li>
              <li>Keep follow-up practical instead of buried in messy notes.</li>
              <li>Stay focused on selling rugs, not learning clunky software.</li>
            </ul>
          </div>

          <figure className="media-card media-card-feature">
            <Image
              src="/media/product/staff-handoff.webp"
              alt="A warm staff-side Rugdesk view showing an interested customer and the rugs they saved."
              width={1536}
              height={1024}
              sizes="(max-width: 900px) 100vw, 48vw"
            loading="eager"
            />
          </figure>
        </div>
      </section>

      <section className="section-block section-light" id="inventory">
        <div className="container section-stack section-stack-tight">
          <div className="section-heading centered-heading inventory-heading">
            <p className="eyebrow">AI inventory digitization</p>
            <h2>Your website can only sell what it can actually show.</h2>
            <p>
              Many rug stores do not have clean online inventory because it takes too much work to keep up. Rugdesk
              helps turn rough photos into cleaner inventory so the digital salesman can show real rugs, not stale
              listings.
            </p>
          </div>

          <div className="inventory-compare-grid">
            <figure className="media-card media-card-plain">
              <div className="media-label">Before</div>
              <Image
                src="/media/inventory/intake-before.webp"
                alt="A rough rug photo taken quickly in store before inventory cleanup."
                width={1536}
                height={1024}
                sizes="(max-width: 900px) 100vw, 42vw"
              loading="eager"
              />
              <figcaption>A quick real-world intake photo, taken the way staff actually work.</figcaption>
            </figure>

            <figure className="media-card media-card-plain media-card-accent">
              <div className="media-label media-label-success">After</div>
              <Image
                src="/media/inventory/intake-after.webp"
                alt="The same rug cleaned up and centered for a clearer online inventory presentation."
                width={1536}
                height={1024}
                sizes="(max-width: 900px) 100vw, 42vw"
              loading="eager"
              />
              <figcaption>Cleaner inventory makes online recommendations more believable and more useful.</figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="section-block how-section" id="how-it-works">
        <div className="container section-stack">
          <div className="section-heading centered-heading narrow-heading">
            <p className="eyebrow">How it works</p>
            <h2>Simple enough for real rug stores. Useful enough to matter.</h2>
          </div>

          <div className="steps-grid">
            {howItWorks.map((step, index) => (
              <article className="step-card" key={step.title}>
                <p className="step-label">Step {index + 1}</p>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-block contact-section" id="contact">
        <div className="container contact-layout">
          <div className="contact-copy">
            <p className="eyebrow">Contact Rugdesk</p>
            <h2>Let’s talk about your website, your inventory, and your sales process.</h2>
            <p>
              If you want a better way to turn website visitors into more serious customer inquiries, send a note. We will keep
              the conversation simple and practical.
            </p>

            <div className="contact-methods">
              <div className="contact-method-card">
                <span className="contact-method-label">Email</span>
                <p className="contact-placeholder">TBD</p>
              </div>
              <div className="contact-method-card">
                <span className="contact-method-label">Phone</span>
                <p className="contact-placeholder">TBD</p>
              </div>
            </div>

            <p className="contact-side-note">
              Want to see the product first? Open the live demo, then come back here when you are ready.
            </p>
            <a
              className="button button-secondary contact-demo-button"
              href="https://demo.rugdesk.app"
              target="_blank"
              rel="noreferrer"
            >
              Open live demo
            </a>
          </div>

          <div className="contact-card-shell">
            <ContactForm />
          </div>
        </div>
      </section>

      <section className="section-block faq-section">
        <div className="container section-stack faq-stack">
          <div className="section-heading centered-heading narrow-heading">
            <p className="eyebrow">Frequently asked questions</p>
            <h2>Clear answers, without tech language.</h2>
          </div>

          <div className="faq-list">
            {faqs.map((item) => (
              <details className="faq-item" key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container footer-inner">
          <p className="footer-brand">Rugdesk</p>
          <p className="footer-copy">
            Built for premium rug stores that want better online customer conversations and cleaner inventory.
          </p>
        </div>
      </footer>
    </main>
  );
}
