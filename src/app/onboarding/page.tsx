import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { KNOWLEDGE_DOMAINS } from '@/types/domain/primitives';
import { LEARNING_LEVELS } from '@/types/domain/user';

export const metadata: Metadata = { title: 'Get started' };

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

/**
 * Onboarding.
 *
 * Collects the two things that actually change what VEO shows a learner:
 * which domains they care about and what level they are working at. Both map
 * directly onto `profiles.interests` and `profiles.level`.
 *
 * Persisting these requires a connected database; the form is wired in the
 * next gate, and this page states that plainly rather than pretending to save.
 */
export default function OnboardingPage() {
  return (
    <AppShell
      title="Set up VEO"
      subtitle="Two questions, so VEO starts you in the right place."
    >
      <div className="flex max-w-3xl flex-col gap-5">
        <Card>
          <CardHeader
            title="What do you want to learn?"
            description="Anatomy is the flagship experience. Other domains use the same spatial engine as their licensed content is published."
          />
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {KNOWLEDGE_DOMAINS.map((domain) => (
                <li key={domain}>
                  <Badge tone={domain === 'anatomy' ? 'accent' : 'neutral'}>
                    {DOMAIN_LABELS[domain] ?? domain}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="What level are you working at?"
            description="Sets the default depth of explanations and the difficulty of generated recall material."
          />
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {LEARNING_LEVELS.map((level) => (
                <li key={level}>
                  <Badge>{level}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/explore" size="lg">
            Start with anatomy
          </ButtonLink>
          <ButtonLink href="/dashboard" variant="secondary" size="lg">
            Go to dashboard
          </ButtonLink>
        </div>
      </div>
    </AppShell>
  );
}
