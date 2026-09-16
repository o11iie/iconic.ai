import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/layout/Logo';
import { HeroFigure } from '@/components/marketing/HeroFigure';
import { ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LEARNING_LOOP, LEGAL_LINKS, SITE } from '@/config/site';
import { KNOWLEDGE_DOMAINS } from '@/types/domain/primitives';

export const metadata: Metadata = {
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
};

/**
 * Landing page.
 *
 * A product website, not an app screen. Static by default: no client JS beyond
 * the hero figure, and nothing here touches the 3D engine — spatial assets must
 * never be pulled during a first visit.
 *
 * Every claim on this page is one VEO can actually stand behind. There are no
 * user counts, no institutional logos, no testimonials and no outcome
 * statistics, because none of those exist yet and inventing them would be
 * exactly the kind of thing this product is built not to do.
 */

const DOMAIN_LABELS: Record<string, string> = {
  anatomy: 'Anatomy',
  health_sciences: 'Health Sciences',
  engineering: 'Engineering',
  chemistry: 'Chemistry',
  physics: 'Physics',
  architecture: 'Architecture',
  computing: 'Computing',
  earth_sciences: 'Earth Sciences',
  astrophysics: 'Astrophysics',
};

const PILLARS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'explore',
    title: 'See the whole thing',
    body: 'Rotate it, cut through it, isolate one part and watch how it sits inside everything else. Structure you can see is structure you can reason about.',
  },
  {
    icon: 'sparkles',
    title: 'Ask about what you are looking at',
    body: 'The tutor knows which structure you have selected. Questions are answered about the thing on screen, not a generic textbook paragraph.',
  },
  {
    icon: 'recall',
    title: 'Keep it after the exam',
    body: 'Understanding fades without retrieval. VEO turns what you explore into recall, and brings it back before you lose it.',
  },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div aria-hidden="true" className="veo-grid-backdrop pointer-events-none absolute inset-0 h-[70vh]" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col px-5 sm:px-6 lg:px-8">
        <header className="flex h-16 items-center justify-between sm:h-20">
          <Link href="/" className="rounded-md" aria-label={`${SITE.name} home`}>
            <Logo />
          </Link>
          <nav aria-label="Account" className="flex items-center gap-1.5 sm:gap-2">
            <ButtonLink href="/login" variant="ghost" size="sm">
              Sign in
            </ButtonLink>
            <ButtonLink href="/signup" size="sm">
              Start learning
            </ButtonLink>
          </nav>
        </header>

        <main id="veo-main">
          {/* ---- hero ---- */}
          <section className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:py-28">
            <div className="flex flex-col items-start gap-6">
              <Badge tone="cyan">Spatial learning platform</Badge>

              <h1 className="max-w-xl text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-6xl lg:text-[4.25rem]">
                <span className="veo-text-gradient">{SITE.tagline}</span>
              </h1>

              <p className="max-w-lg text-base leading-relaxed text-ink-muted sm:text-lg">
                VEO turns complex subjects into interactive spatial models you can explore,
                question and recall. Understand it. Don&rsquo;t just memorise it.
              </p>

              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
                <ButtonLink href="/signup" size="lg">
                  Start learning
                </ButtonLink>
                <ButtonLink href="/explore" variant="secondary" size="lg">
                  Explore VEO
                </ButtonLink>
              </div>

              <p className="text-xs text-ink-faint">
                Pronounced &ldquo;Vee-oh&rdquo;. Free to start.
              </p>
            </div>

            <div className="flex justify-center lg:justify-end">
              <HeroFigure />
            </div>
          </section>

          {/* ---- pillars ---- */}
          <section aria-labelledby="pillars-heading" className="border-t border-hairline py-16 sm:py-20">
            <h2 id="pillars-heading" className="veo-sr-only">
              How VEO works
            </h2>

            <div className="grid gap-10 sm:grid-cols-3 sm:gap-8">
              {PILLARS.map((pillar) => (
                <div key={pillar.title} className="flex flex-col gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-accent/12 text-accent">
                    <Icon name={pillar.icon} size={18} />
                  </span>
                  <h3 className="text-[15px] font-semibold tracking-tight text-ink">
                    {pillar.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-ink-muted">{pillar.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ---- the loop ---- */}
          <section aria-labelledby="loop-heading" className="border-t border-hairline py-16 sm:py-20">
            <div className="max-w-2xl">
              <h2 id="loop-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                One loop, end to end
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
                Understanding without recall fades. Recall without understanding never forms. Every
                part of VEO plugs into the same loop, so the thing you explored on Tuesday is the
                thing you are asked about on Friday.
              </p>
            </div>

            <ol className="mt-10 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3 lg:grid-cols-5">
              {LEARNING_LOOP.map((step, index) => (
                <li key={step.stage} className="flex flex-col gap-1.5">
                  <span className="font-mono text-[11px] text-ink-faint">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-sm font-medium text-ink">{step.label}</span>
                  <span className="text-xs leading-relaxed text-ink-subtle">
                    {step.summary}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* ---- domains ---- */}
          <section aria-labelledby="domains-heading" className="border-t border-hairline py-16 sm:py-20">
            <div className="max-w-2xl">
              <h2 id="domains-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Built for every spatial discipline
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
                VEO Anatomy is the flagship experience. The platform underneath is domain-agnostic
                by construction, so the same engine serves every subject you learn by looking at it.
              </p>
            </div>

            <ul className="mt-8 flex flex-wrap gap-2">
              {KNOWLEDGE_DOMAINS.map((domain) => (
                <li key={domain}>
                  <Badge tone={domain === 'anatomy' ? 'accent' : 'neutral'}>
                    {DOMAIN_LABELS[domain] ?? domain}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>

          {/* ---- close ---- */}
          <section className="border-t border-hairline py-16 sm:py-24">
            <div className="flex flex-col items-start gap-6">
              <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
                The moment it clicks is the moment you remember it.
              </h2>
              <div className="flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/signup" size="lg">
                  Start learning
                </ButtonLink>
                <ButtonLink href="/explore" variant="secondary" size="lg">
                  Explore VEO
                </ButtonLink>
              </div>
            </div>
          </section>
        </main>

        <footer className="flex flex-col gap-4 border-t border-hairline py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-faint">
            © {new Date().getFullYear()} {SITE.name}. {SITE.tagline}
          </p>
          <nav aria-label="Legal" className="flex items-center gap-4">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded text-xs text-ink-faint hover:text-ink-muted"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </footer>
      </div>
    </div>
  );
}
