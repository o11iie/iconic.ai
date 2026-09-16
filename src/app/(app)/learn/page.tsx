import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { SubjectBrowser } from '@/components/learning/SubjectBrowser';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, NotConfiguredState } from '@/components/ui/states';
import { serverCapabilities } from '@/config/env.server';

export const metadata: Metadata = { title: 'Learn' };

/**
 * LEARN — understand, structure, ask.
 *
 * Discovery of subjects, categories and material. The catalogue is honest
 * about what exists: categories awaiting licensed assets are shown so the
 * roadmap is visible, but are marked and cannot be opened.
 */
export default function LearnPage() {
  const ai = serverCapabilities().openai;

  return (
    <AppShell
      title="Learn"
      subtitle="Browse what VEO teaches. Open a subject to see its categories and the models behind them."
    >
      <div className="flex flex-col gap-5">
        {ai ? null : (
          <NotConfiguredState
            title="AI tutor is not configured"
            description="Course generation and the tutor run behind a provider abstraction, called only from VEO server routes so your key is never exposed to the browser."
            requirement="OPENAI_API_KEY"
          />
        )}

        <SubjectBrowser />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Your courses" description="Structured paths through a subject." />
            <CardBody>
              <EmptyState
                title="No courses yet"
                description="Courses are generated from your own material, or published by VEO for a subject."
                icon={<Icon name="learn" size={22} />}
                action={
                  <ButtonLink href="/library" variant="secondary" size="sm">
                    Add material
                  </ButtonLink>
                }
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Concept map"
              description="How the ideas in your material connect to what you can see."
            />
            <CardBody>
              <EmptyState
                title="Nothing structured yet"
                description="Upload material and VEO extracts its concepts, then links them to structures in the spatial model."
                icon={<Icon name="link" size={22} />}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
