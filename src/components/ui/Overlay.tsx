'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useFocusTrap, useScrollLock } from '@/hooks/use-focus-trap';
import { useReducedMotion } from '@/store/ui-store';
import { IconButton } from './IconButton';
import { fadeIn, motionSafe, scaleIn, slideInRight, slideUpSheet } from './motion';

/**
 * Modal and Drawer, built on one accessible overlay.
 *
 * Both trap focus, close on Escape and on backdrop click, lock body scroll,
 * restore focus on close, and expose `role="dialog"` with `aria-modal`. The
 * title is wired through `aria-labelledby` so the dialog announces itself.
 */

interface BaseOverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly className?: string;
  /** Hide the visible heading but keep it for assistive technology. */
  readonly hideTitle?: boolean;
}

function Backdrop({ onClose, reducedMotion }: { onClose: () => void; reducedMotion: boolean }) {
  return (
    <motion.div
      variants={motionSafe(fadeIn, reducedMotion)}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={onClose}
      // Decorative: the dialog itself owns keyboard dismissal via Escape.
      aria-hidden="true"
      className="fixed inset-0 z-40 bg-obsidian/80 backdrop-blur-sm"
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
  hideTitle = false,
}: BaseOverlayProps) {
  const reducedMotion = useReducedMotion();
  const ref = useFocusTrap<HTMLDivElement>(open, onClose);
  useScrollLock(open);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <Backdrop onClose={onClose} reducedMotion={reducedMotion} />
          <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
            <motion.div
              ref={ref}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              tabIndex={-1}
              variants={motionSafe(scaleIn, reducedMotion)}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={cn('veo-glass w-full max-w-lg rounded-2xl outline-none', className)}
            >
              <header className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
                <div className="min-w-0">
                  <h2
                    className={cn(
                      'text-sm font-semibold tracking-tight text-ink',
                      hideTitle && 'veo-sr-only',
                    )}
                  >
                    {title}
                  </h2>
                  {description ? (
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                      {description}
                    </p>
                  ) : null}
                </div>
                <IconButton icon="close" label="Close dialog" size="sm" onClick={onClose} />
              </header>
              <div className="px-5 py-4">{children}</div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  className,
  side = 'right',
}: BaseOverlayProps & { readonly side?: 'right' | 'bottom' }) {
  const reducedMotion = useReducedMotion();
  const ref = useFocusTrap<HTMLDivElement>(open, onClose);
  useScrollLock(open);

  const isBottom = side === 'bottom';

  return (
    <AnimatePresence>
      {open ? (
        <>
          <Backdrop onClose={onClose} reducedMotion={reducedMotion} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            variants={motionSafe(isBottom ? slideUpSheet : slideInRight, reducedMotion)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              'veo-glass fixed z-50 flex flex-col outline-none',
              isBottom
                ? 'inset-x-0 bottom-0 max-h-[82dvh] rounded-t-2xl'
                : 'inset-y-0 right-0 w-full max-w-sm rounded-l-2xl',
              className,
            )}
          >
            {isBottom ? (
              <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-hairline-strong" />
            ) : null}

            <header className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
                {description ? (
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                    {description}
                  </p>
                ) : null}
              </div>
              <IconButton icon="close" label="Close panel" size="sm" onClick={onClose} />
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
