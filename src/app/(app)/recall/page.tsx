import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { RecallModes } from '@/components/learning/RecallModes';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, NotConfiguredState } from '@/components/ui/states';
import { capabilities } from '@/config/env';

export const metadata: Metadata = { title: 'Recall' };

/**
 * RECALL — retrieval practice.
 *
 * Gate 2 delivers the interface and state architecture. Scheduling is
 * deliberately not implemented here: the `memory_states` table already stores
 * scheduler inputs rather than only a due date, so the algorithm can be added
 * later without discarding any learner history.
 */
export default function RecallPage() {
  return (
    <AppShell
      title="Recall"
      subtitle="Retrieve it from memory, not from the page. Choose how you want to be tested."
    >
      <div className="flex flex-col gap-5">
        {capabilities.supabase ? null : (
          <NotConfiguredState
            title="No database connected"
            description="Recall history and scheduling live in Supabase. Until a project is attached, VEO cannot build a real review queue and will not invent one."
            requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
          />
        )}

        <RecallModes />

        <Card>
          <CardHeader
            title="Review schedule"
            description="When each concept is due to come back."
          />
          <CardBody>
            <EmptyState
              title="No review schedule yet"
              description="VEO stores how well you recalled each concept, not just whether you saw it, and uses that to decide when to bring it back."
              icon={<Icon name="clock" size={22} />}
            />
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
