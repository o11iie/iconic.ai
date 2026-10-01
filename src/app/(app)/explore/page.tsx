import { Suspense } from 'react';
import type { Metadata } from 'next';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { LearningWorkspace } from '@/components/workspace/LearningWorkspace';
import { LoadingState } from '@/components/ui/states';
import { capabilities } from '@/config/env';
import { serverCapabilities } from '@/config/env.server';
import { stubEnabled } from '@/ai/providers/verification-stub';
import { getServerUser } from '@/lib/supabase/server';

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

  /*
   * Whether anybody is signed in.
   *
   * /explore is deliberately public — Gate 2's product demonstration — so a
   * visitor here often has no session. Notes are private, so without one
   * there is nothing to fetch, and asking anyway would fire a request
   * guaranteed to answer 401 on every selection a visitor makes. The boolean
   * crosses, never the user.
   */
  const signedIn = capabilities.supabase ? Boolean(await getServerUser()) : false;

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
          signedIn={signedIn}
        />
      </Suspense>
    </WorkspaceShell>
  );
}
