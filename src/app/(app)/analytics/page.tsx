import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { AnalyticsView } from '@/components/analytics/AnalyticsView';
import { NotConfiguredState } from '@/components/ui/states';
import { capabilities } from '@/config/env';

export const metadata: Metadata = { title: 'Analytics' };

/**
 * ANALYTICS — what the learner's reviews actually show.
 *
 * Gate 12 answers "when should this come back?". This answers "what does VEO
 * know about how I am learning?" — from persisted review events and nothing
 * else. Every figure is computed on the server and rendered as received.
 *
 * With no database there is no review history, and VEO says so rather than
 * presenting an empty analytics page as though the learner simply has nothing
 * to show.
 */
export default function AnalyticsPage() {
  return (
    <AppShell
      title="Analytics"
      subtitle="What your reviews show about how you are learning. Every figure comes from reviews you completed — nothing here is estimated."
    >
      {capabilities.supabase ? (
        <AnalyticsView />
      ) : (
        <NotConfiguredState
          title="No database connected"
          description="Learning analytics are derived from your review history, which lives in Supabase. Until a project is attached there is no history to analyse, and VEO will not invent one."
          requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
        />
      )}
    </AppShell>
  );
}
