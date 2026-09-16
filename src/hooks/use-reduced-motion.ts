'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/store/ui-store';

/**
 * Syncs the OS `prefers-reduced-motion` setting into the UI store once, so
 * every animated surface — including the 3D camera rig — reads one value.
 */
export function useSyncReducedMotion(): void {
  const setReducedMotion = useUIStore((s) => s.setReducedMotion);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [setReducedMotion]);
}
