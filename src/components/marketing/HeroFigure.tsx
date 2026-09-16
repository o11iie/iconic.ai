'use client';

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/store/ui-store';

/**
 * Hero figure.
 *
 * Deliberately abstract: concentric apertures and a wireframe lattice that read
 * as "spatial instrument", not as a specimen. VEO does not put a picture of
 * anatomy on its landing page before it has licensed anatomy to show — a
 * rendered stand-in would be a claim the product cannot yet honour.
 */
export function HeroFigure() {
  const reducedMotion = useReducedMotion();

  const spin = reducedMotion
    ? {}
    : { rotate: 360, transition: { duration: 120, repeat: Infinity, ease: 'linear' as const } };

  const counterSpin = reducedMotion
    ? {}
    : { rotate: -360, transition: { duration: 90, repeat: Infinity, ease: 'linear' as const } };

  return (
    <div aria-hidden="true" className="pointer-events-none relative aspect-square w-full max-w-lg">
      {/* Soft field, gives the composition depth without a gradient wash. */}
      <div className="absolute inset-[12%] rounded-full bg-accent/[0.07] blur-3xl" />
      <div className="absolute inset-[26%] rounded-full bg-cyan/[0.06] blur-2xl" />

      <motion.svg
        viewBox="0 0 400 400"
        className="absolute inset-0 size-full"
        fill="none"
        strokeLinecap="round"
      >
        {/* Latitude rings — the spatial lattice. */}
        <motion.g animate={spin} style={{ originX: '200px', originY: '200px' }}>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <ellipse
              key={index}
              cx="200"
              cy="200"
              rx="148"
              ry={148 - index * 26}
              stroke="var(--color-hairline-strong)"
              strokeWidth="1"
              opacity={0.75 - index * 0.08}
            />
          ))}
        </motion.g>

        <motion.g animate={counterSpin} style={{ originX: '200px', originY: '200px' }}>
          {[0, 1, 2, 3].map((index) => (
            <ellipse
              key={index}
              cx="200"
              cy="200"
              rx={148 - index * 34}
              ry="148"
              stroke="var(--color-hairline)"
              strokeWidth="1"
              opacity={0.6 - index * 0.1}
            />
          ))}
        </motion.g>

        <circle cx="200" cy="200" r="148" stroke="var(--color-hairline-strong)" strokeWidth="1.5" />

        {/* The aperture: VEO's mark, scaled up. */}
        <path
          d="M74 200c42-60 84-90 126-90s84 30 126 90c-42 60-84 90-126 90s-84-30-126-90Z"
          stroke="var(--color-cyan)"
          strokeWidth="1.75"
          opacity="0.9"
        />
        <circle cx="200" cy="200" r="42" fill="var(--color-accent)" opacity="0.14" />
        <circle cx="200" cy="200" r="42" stroke="var(--color-accent)" strokeWidth="1.75" />

        {/* Selection marker — the "now I see it" moment, as a diagram. */}
        <motion.g
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.7, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{ originX: '286px', originY: '138px' }}
        >
          <circle cx="286" cy="138" r="7" fill="var(--color-cyan)" />
          <circle cx="286" cy="138" r="15" stroke="var(--color-cyan)" strokeWidth="1" opacity="0.5" />
          <path d="M286 138h56" stroke="var(--color-cyan)" strokeWidth="1" opacity="0.5" />
        </motion.g>
      </motion.svg>
    </div>
  );
}
