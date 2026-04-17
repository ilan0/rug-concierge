import Image from "next/image";
import { ContactForm } from "./contact-form";

const trustPoints = [
  {
    title: "Simple for staff",
    copy: "Add rugs faster without turning your showroom into a software project.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 7.5h15m-15 4.5h15m-15 4.5h9" />
      </svg>
    ),
  },
  {
    title: "Easy for customers",
    copy: "Help shoppers browse, compare, and narrow down choices while they are still engaged.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 18.5 12 5.5l6.5 13M8 13h8" />
      </svg>
    ),
  },
  {
    title: "Rugs stay memorable",
    copy: "Customers can save favorites instead of forgetting what they liked once they walk out.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 20.2-1.2-1.1C6.1 14.9 3 12 3 8.5 3 6 5 4 7.5 4c1.4 0 2.7.6 3.5 1.6C11.8 4.6 13.1 4 14.5 4 17 4 19 6 19 8.5c0 3.5-3.1 6.4-7.8 10.6Z" />
      </svg>
    ),
  },
  {
    title: "Follow-up stays clear",
    copy: "Your staff sees real customer interest and has a clean next step instead of guessing.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 6.5h13v11h-13Zm0 0 6.5 5 6.5-5" />
      </svg>
    ),
  },
];

const steps = [
  {
    step: "Step 1",
    title: "Add rugs quickly",
    copy: "Take a rough photo and turn it into cleaner inventory without slowing down staff.",
  },
  {
    step: "Step 2",
    title: "Guide the customer",
    copy: "Let shoppers browse, compare, and save rugs they like while they are still in the showroom.",
  },
  {
    step: "Step 3",
    title: "Follow up while interest is warm",
    copy: "See what they saved and give your team an easy way to continue the conversation.",
  },
];

const faqs = [
  {
    question: "Do I need to replace how my store works today?",
    answer:
      "No. Rugdesk is meant to help your showroom sell more rugs and organize interest more clearly, not force you into a complicated new process.",
  },
  {
    question: "Can staff really add rugs quickly?",
    answer:
      "Yes. The intake flow is built around quick showroom photos and cleaner inventory presentation so staff can move faster.",
  },
  {
    question: "Is this only for large rug stores?",
    answer:
      "No. The value is clarity and conversion. Smaller showrooms can benefit just as much if they want a better customer experience without extra confusion.",
  },
  {
    question: "Can customers save rugs and come back later?",
    answer:
      "Yes. Customers can save the rugs they like, and your staff can see that interest and follow up in a simple, practical way.",
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
            <p className="eyebrow">For premium rug showrooms</p>
            <h1>Help customers find the right rug without flipping through heavy rugs.</h1>
            <p className="hero-lead">
              Rugdesk gives your showroom a calm digital concierge that helps
              customers browse beautifully, save rugs they love, and gives your
              staff a clearer way to follow up.
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
              <li>Sell with more clarity</li>
              <li>Save staff time</li>
              <li>Keep the showroom premium</li>
            </ul>
          </div>

          <figure className="hero-media-frame">
            <div className="hero-media-shell">
              <Image
                src="/media/hero/hero-composite.webp"
                alt="A premium rug showroom with a tablet showing the Rugdesk concierge and matching rug results."
                width={1536}
                height={1024}
                className="hero-media"
                priority
                sizes="(max-width: 900px) 100vw, 52vw"
              />
            </div>
            <figcaption className="hero-caption">
              A simple digital concierge, designed for the showroom floor.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="trust-section">
        <div className="container trust-grid">
          {trustPoints.map((point) => (
            <article className="trust-card" key={point.title}>
              <span className="icon-chip">{point.icon}</span>
              <h2>{point.title}</h2>
              <p>{point.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block section-light" id="inventory">
        <div className="container section-stack section-stack-tight">
          <div className="section-heading centered-heading">
            <p className="eyebrow">Inventory setup is simple</p>
            <h2>Take a quick rug photo. Turn it into inventory that looks ready to sell.</h2>
            <p>
              Staff should not need perfect photography or extra software
              training just to get rugs into the system.
            </p>
          </div>

          <div className="inventory-compare-grid">
            <figure className="media-card media-card-plain">
              <div className="media-label">Before</div>
              <Image
                src="/media/inventory/intake-before.webp"
                alt="A rough showroom-floor intake photo of a rug taken quickly in store."
                width={1536}
                height={1024}
                sizes="(max-width: 900px) 100vw, 42vw"
              />
              <figcaption>
                A quick in-store photo, taken the way staff actually work.
              </figcaption>
            </figure>

            <figure className="media-card media-card-plain media-card-accent">
              <div className="media-label media-label-success">After</div>
              <Image
                src="/media/inventory/intake-after.webp"
                alt="The same rug cleaned up and centered on a neutral background for inventory use."
                width={1536}
                height={1024}
                sizes="(max-width: 900px) 100vw, 42vw"
              />
              <figcaption>
                Cleaner, brighter, and easier to present to customers.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="container feature-grid">
          <div className="feature-copy">
            <p className="eyebrow">Customers save rugs they like</p>
            <h2>Make it easy to remember the rugs that caught their eye.</h2>
            <p>
              Customers should not leave your store trying to remember which rug
              they liked on the left wall or in the back corner. A saved list
              keeps interest organized without making the experience feel
              technical.
            </p>
            <ul className="feature-list">
              <li>Customers keep a shortlist instead of starting over.</li>
              <li>Staff can continue the conversation from something concrete.</li>
              <li>The showroom experience still feels calm and high-end.</li>
            </ul>
          </div>

          <figure className="media-card media-card-feature">
            <Image
              src="/media/product/saved-rugs.webp"
              alt="Saved favorite rugs displayed in a calm premium Rugdesk shortlist view."
              width={1536}
              height={1024}
              sizes="(max-width: 900px) 100vw, 48vw"
            />
          </figure>
        </div>
      </section>

      <section className="section-block section-warm">
        <div className="container feature-grid feature-grid-reverse">
          <figure className="media-card media-card-feature">
            <Image
              src="/media/product/follow-up.webp"
              alt="A simple Rugdesk follow-up view showing an interested customer and the rugs they saved."
              width={1536}
              height={1024}
              sizes="(max-width: 900px) 100vw, 48vw"
            />
          </figure>

          <div className="feature-copy">
            <p className="eyebrow">Turn interest into follow-up</p>
            <h2>Give your team a clear next step when a customer shows real interest.</h2>
            <p>
              When a shopper saves rugs, your staff should be able to see that
              interest and follow up while it is still warm. That means less
              guessing, fewer lost conversations, and more chances to close the
              right sale.
            </p>
            <ul className="feature-list feature-list-success">
              <li>See who is interested and what they saved.</li>
              <li>Keep follow-up organized without a clunky CRM feel.</li>
              <li>Stay focused on selling rugs, not managing software.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section-block section-light">
        <div className="container section-stack">
          <div className="section-heading centered-heading narrow-heading">
            <p className="eyebrow">How it works</p>
            <h2>Simple enough for the floor. Useful enough to matter.</h2>
          </div>

          <div className="steps-grid">
            {steps.map((step) => (
              <article className="step-card" key={step.title}>
                <p className="step-label">{step.step}</p>
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
            <h2>Tell us about your showroom.</h2>
            <p>
              If you want a calmer, more modern way to help customers browse
              rugs and help staff follow interest, send a note. We will keep the
              conversation simple.
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
              Prefer to explore on your own first? Try the live demo and then
              reach out.
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
            <h2>Direct answers, without the extra noise.</h2>
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
            Built for premium rug showrooms that want to help customers browse
            better and sell with more clarity.
          </p>
        </div>
      </footer>
    </main>
  );
}
