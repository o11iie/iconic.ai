'use client';

import { useEffect } from 'react';

/**
 * Workspace keyboard shortcuts.
 *
 * Deliberately few and unsurprising. Every one is also available as a visible
 * control, so the shortcuts are an accelerator rather than the only path.
 *
 *   Escape — clear selection, or close whatever overlay is open
 *   R      — reset the camera
 *   F      — focus the selected structure
 *
 * Never fires while the learner is typing. A shortcut that hijacks the letter
 * "r" inside a search box is worse than no shortcut at all.
 */

export interface SpatialKeyboardHandlers {
  readonly onEscape?: () => void;
  readonly onReset?: () => void;
  readonly onFocus?: () => void;
  readonly enabled?: boolean;
}

/** True when focus sits in something that accepts text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;

  // A dialog's controls are not text fields, but a shortcut firing behind an
  // open dialog is still wrong.
  return target.closest('[role="dialog"]') !== null;
}

export function useSpatialKeyboard({
  onEscape,
  onReset,
  onFocus,
  enabled = true,
}: SpatialKeyboardHandlers): void {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      // Escape still works while typing — it is how you leave a field.
      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }

      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === 'r') {
        event.preventDefault();
        onReset?.();
      } else if (key === 'f') {
        event.preventDefault();
        onFocus?.();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onEscape, onReset, onFocus, enabled]);
}
