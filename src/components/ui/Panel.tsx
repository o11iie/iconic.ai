import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Panel — a titled region of the interface.
 *
 * Distinct from `Card`: a Card is a discrete object in a list; a Panel is a
 * region of the shell (the context panel, a settings section). Using the right
 * one keeps the interface from degenerating into cards-inside-cards.
 */
// `title` is omitted from HTMLAttributes: the native attribute is a string
// tooltip, whereas a Panel title is rendered content.
export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly glass?: boolean;
  readonly bodyClassName?: string;
  readonly as?: 'section' | 'aside' | 'div';
}

export function Panel({
  title,
  description,
  action,
  glass = false,
  className,
  bodyClassName,
  children,
  as: Tag = 'section',
  ...props
}: PanelProps) {
  return (
    <Tag
      className={cn(
        // `min-w-0` for the same reason as Card: never outgrow the container.
        'flex min-h-0 min-w-0 flex-col rounded-xl',
        glass ? 'veo-glass' : 'border border-hairline bg-surface',
        className,
      )}
      {...props}
    >
      {title || action ? (
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}

      <div className={cn('min-h-0 flex-1', bodyClassName ?? 'p-4')}>{children}</div>
    </Tag>
  );
}

/** A labelled group inside a panel. Keeps section rhythm consistent. */
export function PanelSection({
  label,
  children,
  className,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </h3>
      {children}
    </div>
  );
}
