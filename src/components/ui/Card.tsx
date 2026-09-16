import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly glass?: boolean;
}

export function Card({ className, glass = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        glass ? 'veo-glass' : 'veo-panel',
        'rounded-xl',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 p-5 pb-3', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-tight text-[--color-ink]">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-[--color-ink-muted]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-2', className)} {...props} />;
}
