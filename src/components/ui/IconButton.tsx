import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

type Variant = 'ghost' | 'surface' | 'accent';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-raised',
  surface:
    'bg-surface-raised text-ink-muted border border-hairline-strong hover:text-ink hover:bg-surface-overlay',
  accent: 'bg-accent/16 text-accent hover:bg-accent/24',
};

const SIZES: Record<Size, string> = {
  sm: 'size-8',
  md: 'size-9',
  lg: 'size-11',
};

const ICON_SIZES: Record<Size, number> = { sm: 16, md: 18, lg: 20 };

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: IconName;
  /** REQUIRED. An icon-only control is unusable without an accessible name. */
  readonly label: string;
  readonly variant?: Variant;
  readonly size?: Size;
  readonly active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', active, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      // The label is the accessible name; the tooltip (if any) is supplementary.
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-grid place-items-center rounded-lg transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-accent/16 text-accent' : VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      <Icon name={icon} size={ICON_SIZES[size]} />
    </button>
  );
});
