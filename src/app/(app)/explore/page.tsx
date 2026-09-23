import { Suspense } from 'react';
import type { Metadata } from 'next';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { LearningWorkspace } from '@/components/workspace/LearningWorkspace';
import { LoadingState } from '@/components/ui/states';
import { capabilities } from '@/config/env';
import { serverCapabilities } from '@/config/env.server';
import { stubEnabled } from '@/ai/providers/verification-stub';

export const metadata: Metadata = { title: 'Explore' };

/**
 * EXPLORE — the learning workspace.
 *
 * This is VEO's primary screen. The spatial viewport is the hero: the shell
 * does not scroll, does not pad, and gives every pixel it can to the model.
 *
 * `?diagnostic=1` mounts the render-pipeline diagnostic instead of a model.
 * That path is gated behind NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC and is
 * labelled in the viewport as a non-anatomical calibration object.
 */
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ diagnostic?: string }>;
}) {
  const params = await searchParams;
  const diagnostic = capabilities.pipelineDiagnostic && params.diagnostic === '1';
  /*
   * Resolved on the server: OPENAI_API_KEY is server-only and must never be
   * readable from the browser, so only the boolean crosses.
   *
   * The verification stub counts as configured, and says so separately, so a
   * run against it is never mistaken for the real provider answering.
   */
  const usingStub = stubEnabled();
  const aiConfigured = serverCapabilities().openai || usingStub;

  return (
    <WorkspaceShell>
      <Suspense
        fallback={
          <div className="grid flex-1 place-items-center">
            <LoadingState label="Opening workspace" />
          </div>
        }
      >
        <LearningWorkspace
          diagnostic={diagnostic}
          aiConfigured={aiConfigured}
          tutorStub={usingStub}
          recallConfigured={capabilities.supabase}
        />
      </Suspense>
    </WorkspaceShell>
  );
}
