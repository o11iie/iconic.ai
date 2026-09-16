'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/states';

/**
 * Route-level error boundary.
 *
 * Runtime failures are surfaced, never swallowed: the digest is shown so a
 * report can be matched to server logs, and reset() actually re-renders the
 * segment rather than reloading the whole app.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[veo] route error', error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl items-center px-6">
      <ErrorState
        title="This page could not be rendered"
        description="The error has been logged. You can retry this section without losing the rest of your session."
        detail={error.digest ? `${error.message}\n\ndigest: ${error.digest}` : error.message}
        action={
          <Button onClick={reset} size="sm">
            Try again
          </Button>
        }
        className="w-full"
      />
    </div>
  );
}
