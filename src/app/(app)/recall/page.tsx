import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { RecallModes } from '@/components/learning/RecallModes';
import { RecallPanel } from '@/components/recall/RecallPanel';
import { NotConfiguredState } from '@/components/ui/states';
import { capabilities } from '@/config/env';

export const metadata: Metadata = { title: 'Recall' };

/**
 * RECALL — retrieval practice.
 *
 * The scheduler decides what comes back and when; this page shows what it
 * decided and lets the learner do it. Every figure on it is computed on the
 * server from persisted review rows, so a learner is never shown a number the
 * browser invented.
 *
 * Without a database there is no review history, and VEO says so rather than
 * presenting an empty schedule as though the learner simply has nothing due.
 */
export default function RecallPage() {
  return (
    <AppShell
      title="Recall"
      subtitle="Retrieve it from memory, not from the page. VEO brings each thing back just before you would forget it."
    >
      <div className="flex flex-col gap-5">
        {capabilities.supabase ? (
          <RecallPanel />
        ) : (
          <NotConfiguredState
            title="No database connected"
            description="Recall history and scheduling live in Supabase. Until a project is attached, VEO cannot build a real review queue and will not invent one."
            requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
          />
        )}

        <RecallModes />
      </div>
    </AppShell>
  );
}
