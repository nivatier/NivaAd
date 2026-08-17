import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicy,
  head: () => ({ meta: [{ title: "Privacy Policy — NivaSpark" }] }),
});

const sections = [
  {
    number: "1",
    title: "What We Collect",
    content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-3">
          We collect the following information when you use NivaSpark:
        </p>
        <ul className="space-y-2 text-muted-foreground">
          {[
            "Account information: company name, email address, full name",
            "Product and brand data you upload to the platform",
            "Generated ad content and campaign history",
            "Usage data: feature interactions, session duration, error logs",
            "Payment information: processed and stored by Stripe — we never store card details",
            "OAuth tokens for connected social platforms (stored encrypted)",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    number: "2",
    title: "How We Use Your Data",
    content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-3">
          We use your data to:
        </p>
        <ul className="space-y-2 text-muted-foreground">
          {[
            "Provide and improve the NivaSpark service",
            "Generate AI-powered ad content using your product briefs",
            "Process payments and manage your subscription",
            "Send transactional emails (account verification, billing receipts)",
            "Send promotional emails (product updates, special offers, newsletters, and marketing campaigns)",
            "Monitor platform health and prevent abuse",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    number: "3",
    title: "Data Storage",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        Your data is stored on Railway-managed PostgreSQL infrastructure. Media files are stored on Cloudflare R2.
        We do not sell your data to third parties.
      </p>
    ),
  },
  {
    number: "4",
    title: "Third-Party Services",
    content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-3">
          NivaSpark integrates with the following third-party services:
        </p>
        <ul className="space-y-2 text-muted-foreground">
          {[
            "Stripe — payment processing",
            "AWS SES — transactional and promotional emails",
            "OpenRouter — AI model access",
            "Cloudflare R2 — media storage",
            "LinkedIn, Instagram, Facebook, TikTok, X, Threads etc. — social posting via OAuth",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-3">
          Each service operates under its own privacy policy.
        </p>
      </>
    ),
  },
  {
    number: "5",
    title: "Data Retention",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        Account data is retained for the duration of your subscription plus 90 days after cancellation.
        You may request deletion of your data at any time by contacting us.
      </p>
    ),
  },
  {
    number: "6",
    title: "Your Rights",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        You have the right to access, correct, export or delete your personal data. To exercise these rights,
        contact{" "}
        <a href="mailto:contact.privacy@nivatier.com" className="text-primary hover:underline">
          contact.privacy@nivatier.com
        </a>
        .
      </p>
    ),
  },
  {
    number: "7",
    title: "Cookies",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        We use essential cookies for authentication and session management. See our Cookie Notice for details.
      </p>
    ),
  },
  {
    number: "8",
    title: "Children's Privacy",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        NivaSpark is not directed at children under 18. We do not knowingly collect data from minors.
      </p>
    ),
  },
  {
    number: "9",
    title: "Changes to This Policy",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        We may update this policy periodically. We will notify registered users of material changes by email.
      </p>
    ),
  },
];

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border/40 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo-wording-dark.png" alt="NivaSpark" className="h-7 dark:block hidden" />
            <img src="/logo-wording-dark.png" alt="NivaSpark" className="h-7 dark:hidden block" />
          </Link>
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="border-b border-border/40 px-6 py-14">
        <div className="mx-auto max-w-4xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-primary">
            Legal
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Privacy Policy
          </h1>
          <div className="mt-4 flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span>Effective date: 1 January 2026</span>
            <span className="hidden sm:block text-border">|</span>
            <span>Operated by: Nivatier FZ-LLC, Expo City Dubai, United Arab Emirates</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="px-6 py-12">
        <div className="mx-auto max-w-4xl space-y-10">
          {sections.map((section) => (
            <div
              key={section.number}
              className="grid gap-4 sm:grid-cols-[3rem_1fr]"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {section.number}
              </div>
              <div>
                <h2 className="mb-3 text-lg font-semibold text-foreground">
                  {section.title}
                </h2>
                {section.content}
              </div>
            </div>
          ))}

          {/* Contact */}
          <div className="rounded-xl border border-border/60 bg-card p-6">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Privacy enquiries: </span>
              <a
                href="mailto:contact.privacy@nivatier.com"
                className="text-primary hover:underline"
              >
                contact.privacy@nivatier.com
              </a>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} Nivatier FZ-LLC. All rights reserved.</span>
          <Link to="/terms" className="hover:text-foreground transition-colors">
            Terms of Service →
          </Link>
        </div>
      </footer>
    </div>
  );
}
