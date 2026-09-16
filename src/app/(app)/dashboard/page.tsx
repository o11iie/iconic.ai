import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState, NotConfiguredState } from '@/components/ui/states';
import { LEARNING_LOOP } from '@/config/site';
import { capabilities } from '@/config/env';
import { getServerUser } from '@/lib/supabase/server';
import { SUBJECTS, CONTENT_STATUS_LABEL } from '@/data/subjects';

export const metadata: Metadata = { title: 'Home' };

/**
 * Home.
 *
 * Answers one question: what should I do next?
 *
 * It shows NO statistics. Every number would have to be invented until real
 * sessions and recall attempts exist, and a dashboard of fabricated progress is
 * exactly the thing that looks finished while teaching nothing. Where data does
 * not exist yet, the empty state says so and offers the real next action.
 */
export default async function HomePage() {
  const user = capabilities.supabase ? await getServerUser() : null;
  const firstName =
    ((user?.user_metadata?.display_name as string | undefined) ?? user?.email?.split('@')[0] ?? '')
      .split(/[\s._-]/)[0] ?? '';

  return (
    <AppShell
      title={firstName ? `Welcome back, ${firstName}` : 'Home'}
      subtitle="Your position in the VEO learning loop. Progress appears here once you have material and recall history — nothing on this page is simulated."
    >
      <div className="flex flex-col gap-4">
        {capabilities.supabase ? null : (
          <NotConfiguredState
            title="No database connected"
            description="Sessions, materials and recall history are stored in Supabase. Until a project is attached this page cannot show real progress, and will not invent any."
            requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
          />
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Continue learning"
              description="Pick up your most recent session, or start a new one."
            />
            <CardBody>
              <EmptyState
                title="No learning sessions yet"
                description="Open a model and start exploring. Your sessions appear here with the structures you studied."
                icon={<Icon name="explore" size={22} />}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <ButtonLink href="/explore" size="sm">
                      Open the workspace
                    </ButtonLink>
                    <ButtonLink href="/learn" variant="secondary" size="sm">
                      Browse subjects
                    </ButtonLink>
                  </div>
                }
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recall due" description="Scheduled retrieval practice." />
            <CardBody>
              <EmptyState
                title="Nothing is due for recall yet"
                description="Once you study something, VEO schedules it to come back just before you would forget it."
                icon={<Icon name="recall" size={22} />}
                className="p-6"
              />
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Your subjects"
              description="What VEO is built to teach, and what is ready today."
              action={
                <ButtonLink href="/learn" variant="ghost" size="sm">
                  Browse
                </ButtonLink>
              }
            />
            <CardBody>
              <ul className="flex flex-col divide-y divide-hairline">
                {SUBJECTS.slice(0, 4).map((subject) => (
                  <li key={subject.slug} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised text-ink-subtle">
                      <Icon name={subject.icon as IconName} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {subject.name}
                      </span>
                      <span className="block truncate text-xs text-ink-faint">
                        {subject.description}
                      </span>
                    </span>
                    <Badge tone={subject.contentStatus === 'available' ? 'success' : 'warning'}>
                      {CONTENT_STATUS_LABEL[subject.contentStatus]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Saved models and materials"
              description="Everything you have kept for later."
            />
            <CardBody>
              <EmptyState
                title="Your saved models will appear here"
                description="Save a model or upload your own material from the Library."
                icon={<Icon name="library" size={22} />}
                action={
                  <ButtonLink href="/library" variant="secondary" size="sm">
                    Go to Library
                  </ButtonLink>
                }
              />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="The learning loop" description="Every VEO feature plugs into this." />
          <CardBody>
            <ol className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
              {LEARNING_LOOP.map((step, index) => (
                <li key={step.stage} className="flex flex-col gap-1">
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
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
