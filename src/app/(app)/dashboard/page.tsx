import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState, NotConfiguredState } from '@/components/ui/states';
import { LEARNING_LOOP } from '@/config/site';
import { capabilities } from '@/config/env';
import { getServerUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Dashboard.
 *
 * Deliberately shows NO statistics. Every number here would have to be invented
 * until real recall attempts exist, and a dashboard of fabricated progress is
 * exactly the kind of thing that looks finished while teaching nothing. It
 * shows the learning loop, the user's real state, and the next real action.
 */
export default async function DashboardPage() {
  const user = capabilities.supabase ? await getServerUser() : null;

  return (
    <AppShell
      title={user?.email ? `Welcome back` : 'Dashboard'}
      subtitle="Your position in the VEO learning loop. Progress appears here once you have material and recall history — nothing on this page is simulated."
    >
      <div className="flex flex-col gap-5">
        {capabilities.supabase ? null : (
          <NotConfiguredState
            title="No database connected"
            description="Sessions, materials and recall history are stored in Supabase. Until a project is attached, this page cannot show real progress — and will not invent any."
            requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
          />
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Continue learning"
              description="Pick up the most recent session, or start a new one."
            />
            <CardBody>
              <EmptyState
                title="No sessions yet"
                description="Start by exploring a spatial model or uploading your own material. Your sessions and recall history will appear here."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <ButtonLink href="/explore" size="sm">
                      Explore models
                    </ButtonLink>
                    <ButtonLink href="/library" variant="secondary" size="sm">
                      Add material
                    </ButtonLink>
                  </div>
                }
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Due for review" description="Spaced repetition queue." />
            <CardBody>
              <EmptyState
                title="Nothing due"
                description="Once you start recalling concepts, VEO schedules them to return just before you would forget."
                className="p-6"
              />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="The learning loop"
            description="Every VEO feature plugs into this loop."
          />
          <CardBody>
            <ol className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
              {LEARNING_LOOP.map((step, index) => (
                <li key={step.stage} className="flex flex-col gap-1">
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
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
