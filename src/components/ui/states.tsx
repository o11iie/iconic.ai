import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Loading, empty and error states.
 *
 * These exist as first-class components because VEO's rule is that a failure
 * must never disappear silently. Every surface that can fail imports from here
 * rather than rendering an ambiguous blank box.
 */

export function LoadingState({
  label = 'Loading',
  className,
}: {
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 p-10 text-center', className)}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className="size-6 animate-spin rounded-full border-2 border-[--color-hairline-strong] border-t-[--color-cyan]"
      />
      <p className="text-sm text-[--color-ink-muted]">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed',
        'border-[--color-hairline-strong] p-10 text-center',
        className,
      )}
    >
      {icon ? <div className="text-[--color-ink-faint]">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-[--color-ink]">{title}</h3>
      {description ? (
        <p className="max-w-prose text-sm leading-relaxed text-[--color-ink-muted]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  detail,
  action,
  className,
}: {
  readonly title?: string;
  readonly description?: string;
  /** Technical detail. Shown in a disclosure so it is available but not shouty. */
  readonly detail?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-xl border p-5',
        'border-[--color-danger]/30 bg-[--color-danger]/[0.06]',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[--color-danger]" />
        <h3 className="text-sm font-semibold text-[--color-ink]">{title}</h3>
      </div>
      {description ? (
        <p className="text-sm leading-relaxed text-[--color-ink-muted]">{description}</p>
      ) : null}
      {detail ? (
        <details className="w-full">
          <summary className="cursor-pointer text-xs text-[--color-ink-subtle] hover:text-[--color-ink-muted]">
            Technical detail
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-[--color-obsidian] p-3 text-xs leading-relaxed text-[--color-ink-subtle]">
            {detail}
          </pre>
        </details>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/**
 * A capability that is architecturally complete but not configured in this
 * environment. Deliberately distinct from an error: nothing is broken, a key
 * or licence is simply absent.
 */
export function NotConfiguredState({
  title,
  description,
  requirement,
  className,
}: {
  readonly title: string;
  readonly description: string;
  /** The exact env var or licence needed, so it is actionable. */
  readonly requirement?: string;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-xl border p-5',
        'border-[--color-warning]/25 bg-[--color-warning]/[0.05]',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[--color-warning]" />
        <h3 className="text-sm font-semibold text-[--color-ink]">{title}</h3>
      </div>
      <p className="max-w-prose text-sm leading-relaxed text-[--color-ink-muted]">{description}</p>
      {requirement ? (
        <code className="rounded-md bg-[--color-obsidian] px-2 py-1 font-mono text-xs text-[--color-cyan]">
          {requirement}
        </code>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-[--color-surface-raised]', className)}
    />
  );
}
