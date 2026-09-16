'use client';

import type { Transition, Variants } from 'framer-motion';

/**
 * Shared motion vocabulary.
 *
 * VEO's motion is short, eased and purposeful: it explains where something came
 * from. Nothing bounces, nothing loops, nothing decorates. Every variant here
 * animates opacity and small translations only, so a reduced-motion user losing
 * the transform loses nothing meaningful.
 */

export const EASE_OUT_EXPO: Transition['ease'] = [0.16, 1, 0.3, 1];

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.24, ease: EASE_OUT_EXPO } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
};

export const riseIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT_EXPO } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.16 } },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 16 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.28, ease: EASE_OUT_EXPO } },
  exit: { opacity: 0, x: 16, transition: { duration: 0.18 } },
};

export const slideUpSheet: Variants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: { duration: 0.34, ease: EASE_OUT_EXPO } },
  exit: { y: '100%', transition: { duration: 0.22, ease: EASE_OUT_EXPO } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT_EXPO } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.14 } },
};

/** Stagger children without animating the container itself. */
export const staggerList: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
  exit: {},
};

/**
 * Strip motion when the user asks for less of it.
 *
 * Returns variants that still drive mount/unmount (so AnimatePresence keeps
 * working) but move nothing.
 */
export function motionSafe(variants: Variants, reducedMotion: boolean): Variants {
  if (!reducedMotion) return variants;
  return {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.01 } },
    exit: { opacity: 0, transition: { duration: 0.01 } },
  };
}
