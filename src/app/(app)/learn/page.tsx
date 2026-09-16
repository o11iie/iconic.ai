import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState, NotConfiguredState } from '@/components/ui/states';
import { serverCapabilities } from '@/config/env.server';

export const metadata: Metadata = { title: 'Learn' };

/**
 * LEARN — understand, structure, ask.
 *
 * The AI tutor is abstracted behind `src/ai` and reached only through server
 * routes, so the key never touches the browser. Until a key is configured this
 * page says so rather than offering a chat box that silently fails.
 */
export default function LearnPage() {
  const ai = serverCapabilities().openai;

  return (
    <AppShell
      title="Learn"
      subtitle="Work through material concept by concept, with a tutor that can see the same model you are looking at."
    >
      <div className="flex flex-col gap-5">
        {ai ? null : (
          <NotConfiguredState
            title="AI tutor is not configured"
            description="The tutor is implemented behind a provider abstraction and called only from VEO server routes, so your key is never exposed to the browser. Add a key to enable it."
            requirement="OPENAI_API_KEY"
          />
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Your courses"
              description="Structured paths through a subject."
            />
            <CardBody>
              <EmptyState
                title="No courses yet"
                description="Courses are generated from your material, or published by VEO for a subject."
                action={
                  <ButtonLink href="/library" size="sm" variant="secondary">
                    Go to library
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
                description="Upload material and VEO extracts concepts, then links them to structures in the spatial model."
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
