import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'cyan' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-[--color-surface-raised] text-[--color-ink-muted] border-[--color-hairline-strong]',
  accent: 'bg-[--color-accent]/12 text-[--color-accent] border-[--color-accent]/25',
  cyan: 'bg-[--color-cyan]/12 text-[--color-cyan] border-[--color-cyan]/25',
  success: 'bg-[--color-success]/12 text-[--color-success] border-[--color-success]/25',
  warning: 'bg-[--color-warning]/12 text-[--color-warning] border-[--color-warning]/25',
  danger: 'bg-[--color-danger]/12 text-[--color-danger] border-[--color-danger]/25',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: Tone;
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
        'text-[11px] font-medium tracking-wide',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
