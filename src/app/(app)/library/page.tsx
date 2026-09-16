import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, NotConfiguredState } from '@/components/ui/states';
import { Badge } from '@/components/ui/Badge';
import { MATERIAL_KINDS } from '@/types/domain/knowledge';
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

        <Card>
          <CardHeader
            title="Your material"
            description="PDFs, notes and links VEO can turn into concepts, questions and flashcards."
          />
          <CardBody className="flex flex-col gap-4">
            <EmptyState
              title="Nothing uploaded yet"
              description="Add a lecture PDF or your own notes. VEO extracts the concepts, links them to spatial structures where they exist, and builds recall material from them."
            />
            <div>
              <h3 className="text-xs font-medium text-[--color-ink-subtle]">Supported formats</h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {MATERIAL_KINDS.map((kind) => (
                  <li key={kind}>
                    <Badge>{kind.replace('_', ' ')}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
