'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary. Replaces the root layout, so it must render its own
 * <html> and <body> and cannot rely on global styles being present.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[veo] global error', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          backgroundColor: '#090d16',
          color: '#f1f5f9',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: '1.5rem',
        }}
      >
        <main style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            VEO failed to start
          </h1>
          <p style={{ color: '#94a3b8', lineHeight: 1.6, margin: '0 0 1rem' }}>
            A fatal error occurred before the interface could render.
            {error.digest ? ` Reference: ${error.digest}.` : ''}
          </p>
          <button
            onClick={reset}
            style={{
              height: '2.5rem',
              padding: '0 1rem',
              borderRadius: '0.5rem',
              border: 'none',
              backgroundColor: '#3b82f6',
              color: '#fff',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Reload VEO
          </button>
        </main>
      </body>
    </html>
  );
}
