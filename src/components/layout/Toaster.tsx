'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/IconButton';
import { Icon, type IconName } from '@/components/ui/Icon';
import { motionSafe, riseIn } from '@/components/ui/motion';
import { useReducedMotion, useToasts, useUIStore, type ToastTone } from '@/store/ui-store';

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  error: 'alert',
};

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'text-cyan',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
};

/**
 * Toast region.
 *
 * `role="status"` with `aria-live="polite"` so messages are announced without
 * stealing focus. Error toasts have no duration and stay until dismissed —
 * a failure that disappears on its own is a failure nobody can act on.
 */
export function Toaster() {
  const toasts = useToasts();
  const dismiss = useUIStore((s) => s.dismissToast);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.durationMs !== null)
      .map((toast) => window.setTimeout(() => dismiss(toast.id), toast.durationMs as number));

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts, dismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:right-6 md:left-auto md:items-end md:px-0"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            variants={motionSafe(riseIn, reducedMotion)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="veo-glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3"
          >
            <Icon name={TONE_ICON[toast.tone]} size={16} className={cn('mt-0.5', TONE_CLASS[toast.tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                  {toast.description}
                </p>
              ) : null}
            </div>
            <IconButton icon="close" label="Dismiss" size="sm" onClick={() => dismiss(toast.id)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
