import { Logo } from '@/components/layout/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LEARNING_LOOP, SITE } from '@/config/site';
import { KNOWLEDGE_DOMAINS } from '@/types/domain/primitives';

/**
 * Landing page.
 *
 * Static by default (no client JS beyond Next's runtime) so the first paint is
 * immediate. Nothing here loads the 3D engine: spatial assets are large and
 * must never be pulled during initial application boot.
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

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh">
      <div aria-hidden="true" className="veo-grid-backdrop pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex max-w-6xl flex-col px-6 lg:px-8">
        <header className="flex h-16 items-center justify-between">
          <Logo />
          <nav aria-label="Account" className="flex items-center gap-2">
            <ButtonLink href="/login" variant="ghost" size="sm">
              Sign in
            </ButtonLink>
            <ButtonLink href="/signup" size="sm">
              Get started
            </ButtonLink>
          </nav>
        </header>

        <main id="veo-main">
          <section className="flex flex-col items-start gap-6 py-20 lg:py-28">
            <Badge tone="cyan">Spatial learning platform</Badge>

            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              <span className="veo-text-gradient">{SITE.tagline}</span>
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-[--color-ink-muted] sm:text-lg">
              {SITE.name} ({SITE.pronunciation}) helps you understand and remember complex subjects
              by seeing them. Explore interactive models in three dimensions, ask questions of what
              you are looking at, and hold on to it with active recall.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <ButtonLink href="/signup" size="lg">
                Start learning
              </ButtonLink>
              <ButtonLink href="/explore" variant="secondary" size="lg">
                Explore models
              </ButtonLink>
            </div>
          </section>

          <section aria-labelledby="loop-heading" className="border-t border-[--color-hairline] py-16">
            <h2 id="loop-heading" className="text-sm font-semibold tracking-tight">
              The VEO learning loop
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[--color-ink-muted]">
              Every feature in VEO plugs into one loop. Understanding without recall fades; recall
              without understanding never forms.
            </p>

            <ol className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">
              {LEARNING_LOOP.map((step, index) => (
                <li key={step.stage} className="flex flex-col gap-1.5">
                  <span className="font-mono text-[11px] text-[--color-ink-faint]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-sm font-medium text-[--color-ink]">{step.label}</span>
                  <span className="text-xs leading-relaxed text-[--color-ink-subtle]">
                    {step.summary}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="domains-heading" className="border-t border-[--color-hairline] py-16">
            <h2 id="domains-heading" className="text-sm font-semibold tracking-tight">
              Built for every spatial discipline
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[--color-ink-muted]">
              VEO Anatomy is the flagship experience. The platform underneath is domain-agnostic by
              construction, so the same engine serves every subject you learn by looking at it.
            </p>

            <ul className="mt-6 flex flex-wrap gap-2">
              {KNOWLEDGE_DOMAINS.map((domain) => (
                <li key={domain}>
                  <Badge tone={domain === 'anatomy' ? 'accent' : 'neutral'}>
                    {DOMAIN_LABELS[domain] ?? domain}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        </main>

        <footer className="mt-auto border-t border-[--color-hairline] py-8">
          <p className="text-xs text-[--color-ink-faint]">
            © {new Date().getFullYear()} {SITE.name}. {SITE.tagline}
          </p>
        </footer>
      </div>
    </div>
  );
}
