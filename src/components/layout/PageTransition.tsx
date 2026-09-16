'use client';

import { motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useReducedMotion } from '@/store/ui-store';
import { motionSafe, riseIn } from '@/components/ui/motion';

/**
 * Route-level entrance.
 *
 * Keyed on pathname so each route animates in once. Deliberately a mount
 * animation only — no exit transition, because delaying unmount makes
 * navigation feel slower, which is the opposite of premium.
 */
export function PageTransition({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      key={pathname}
      variants={motionSafe(riseIn, reducedMotion)}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}
