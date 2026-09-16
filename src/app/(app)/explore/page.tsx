import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { AnatomyExplorer } from '@/components/anatomy/AnatomyExplorer';
import { Badge } from '@/components/ui/Badge';
import { capabilities } from '@/config/env';

export const metadata: Metadata = { title: 'Explore' };

/**
 * EXPLORE — the spatial surface of the learning loop.
 *
 * `?diagnostic=1` mounts the render-pipeline diagnostic instead of a model.
 * That path is gated behind NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC and is
 * clearly labelled in the viewport as a non-anatomical calibration object.
 */
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ diagnostic?: string }>;
}) {
  const params = await searchParams;
  const diagnostic = capabilities.pipelineDiagnostic && params.diagnostic === '1';

  return (
    <AppShell
      title="Explore"
      subtitle="See it, turn it, take it apart. Selection, isolation and camera framing all work against permanent VEO semantic identity, not vendor mesh names."
      actions={
        diagnostic ? (
          <Badge tone="warning">Pipeline diagnostic</Badge>
        ) : (
          <Badge tone="cyan">Anatomy</Badge>
        )
      }
    >
      <AnatomyExplorer diagnostic={diagnostic} />
    </AppShell>
  );
}
