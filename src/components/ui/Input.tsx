import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  /** Render the label for screen readers only. */
  readonly hideLabel?: boolean;
}

/**
 * A labelled text input.
 *
 * The label is required, not optional: a placeholder is not a label, and an
 * unlabelled field is unusable with a screen reader. `hideLabel` exists for
 * dense layouts and still emits a real <label>.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, hideLabel = false, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className={cn(
          'text-xs font-medium text-[--color-ink-muted]',
          hideLabel && 'veo-sr-only',
        )}
      >
        {label}
      </label>

      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hint && hintId, error && errorId) || undefined}
        className={cn(
          'h-10 w-full rounded-lg border bg-[--color-obsidian] px-3 text-sm text-[--color-ink]',
          'placeholder:text-[--color-ink-faint]',
          'transition-colors duration-150',
          error
            ? 'border-[--color-danger]/60'
            : 'border-[--color-hairline-strong] hover:border-[--color-ink-faint]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />

      {hint && !error ? (
        <p id={hintId} className="text-xs text-[--color-ink-subtle]">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-[--color-danger]">
          {error}
        </p>
      ) : null}
    </div>
  );
});
