import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { LibraryTabs } from '@/components/learning/LibraryTabs';
import { NotConfiguredState } from '@/components/ui/states';
import { capabilities } from '@/config/env';

export const metadata: Metadata = { title: 'Library' };

/**
 * LIBRARY — the UPLOAD entry point of the learning loop.
 *
 * Uploads go to a private Supabase Storage bucket namespaced by user id, with
 * storage policies enforcing that a user can only reach their own folder
 * (see supabase/migrations/0002_row_level_security.sql).
 */
export default function LibraryPage() {
  return (
    <AppShell
      title="Library"
      subtitle="Your source material and everything VEO has generated from it."
    >
      <div className="flex flex-col gap-5">
        {capabilities.supabase ? null : (
          <NotConfiguredState
            title="Storage is not connected"
            description="Uploads are stored in a private Supabase Storage bucket, scoped per user by storage policies. Connect a project to enable uploading."
            requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
          />
        )}

        <LibraryTabs />
      </div>
    </AppShell>
  );
}
