'use client';

import type { ReactNode } from 'react';
import { useSyncReducedMotion } from '@/hooks/use-reduced-motion';
import { Toaster } from '@/components/layout/Toaster';

/**
 * Client-side application providers.
 *
 * Deliberately thin: VEO uses Zustand rather than context, so there is no
 * provider tree to build. This only syncs OS-level preferences into the store
 * and mounts the toast region once for the whole app.
 */
export function AppProviders({ children }: { readonly children: ReactNode }) {
  useSyncReducedMotion();

  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
