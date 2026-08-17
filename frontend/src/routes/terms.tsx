import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsOfService,
  head: () => ({ meta: [{ title: "Terms of Service — NivaSpark" }] }),
});

const sections = [
  {
    number: "1",
    title: "Acceptance of Terms",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        By creating an account or using NivaSpark, you agree to these Terms of Service.
        If you do not agree, do not use the platform.
      </p>
    ),
  },
  {
    number: "2",
    title: "Description of Service",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        NivaSpark is an AI-powered advertising studio that generates copy, image and video ads for social
        media platforms. Features include campaign planning, scheduled posting, brand kit management,
        and Agent Niva automation.
      </p>
    ),
  },
  {
    number: "3",
    title: "Account Eligibility",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        You must be at least 18 years old and authorised to enter into contracts on behalf of your business
        to use NivaSpark. Each account represents a freelancer, single company or brand.
      </p>
    ),
  },
  {
    number: "4",
    title: "Acceptable Use",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        You agree not to use NivaSpark to generate content that is misleading, defamatory, unlawful,
        or in violation of any platform's advertising policies. You are solely responsible for the
        ads you create and publish.
      </p>
    ),
  },
  {
    number: "5",
    title: "Credits and Billing",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        NivaSpark operates on a credit-based system. Credits are consumed when generating ads.
        Subscription plans include a monthly credit allocation. Unused credits do not roll over
        unless stated in your plan. All payments are processed via Stripe and are non-refundable
        except where required by law.
      </p>
    ),
  },
  {
    number: "6",
    title: "Intellectual Property",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        You retain ownership of the content you upload (product images, brand assets). NivaSpark
        retains ownership of its platform, models and tooling. AI-generated outputs are assigned
        to you upon generation.
      </p>
    ),
  },
  {
    number: "7",
    title: "Platform Integrations",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        NivaSpark connects to third-party platforms (LinkedIn, Instagram, Facebook, TikTok, X,
        Threads etc.) via OAuth. We are not responsible for changes to those platforms' APIs,
        policies or availability.
      </p>
    ),
  },
  {
    number: "8",
    title: "Limitation of Liability",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        NivaSpark is provided as-is. Nivatier FZ-LLC shall not be liable for any indirect,
        incidental or consequential damages arising from your use of the platform.
      </p>
    ),
  },
  {
    number: "9",
    title: "Termination",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        We reserve the right to suspend or terminate accounts that violate these Terms,
        misuse the platform, or engage in fraudulent activity.
      </p>
    ),
  },
  {
    number: "10",
    title: "Governing Law",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        These Terms are governed by the laws of the United Arab Emirates. Any disputes shall
        be resolved in the courts of Dubai.
      </p>
    ),
  },
  {
    number: "11",
    title: "Changes to Terms",
    content: (
      <p className="text-muted-foreground leading-relaxed">
        We may update these Terms from time to time. Continued use of NivaSpark after changes
        constitutes acceptance of the new Terms.
      </p>
    ),
  },
];

function TermsOfService() {
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
            Terms of Service
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
              <span className="font-medium text-foreground">Legal enquiries: </span>
              <a
                href="mailto:contact.legal@nivatier.com"
                className="text-primary hover:underline"
              >
                contact.legal@nivatier.com
              </a>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} Nivatier FZ-LLC. All rights reserved.</span>
          <Link to="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy →
          </Link>
        </div>
      </footer>
    </div>
  );
}
