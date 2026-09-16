import { cn } from '@/lib/cn';

/**
 * VEO wordmark. The mark is an eye/aperture built from concentric arcs —
 * "learning you can see" — rendered as inline SVG so it stays crisp and
 * themeable without an asset request.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  readonly className?: string;
  readonly showWordmark?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-6 shrink-0"
        fill="none"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="9.25" stroke="var(--color-hairline-strong)" strokeWidth="1.5" />
        <path
          d="M4.4 12c2.6-3.7 5.1-5.5 7.6-5.5s5 1.8 7.6 5.5c-2.6 3.7-5.1 5.5-7.6 5.5S7 15.7 4.4 12Z"
          stroke="var(--color-cyan)"
          strokeWidth="1.5"
        />
        <circle cx="12" cy="12" r="2.6" fill="var(--color-accent)" />
      </svg>
      {showWordmark ? (
        <span className="text-[15px] font-semibold tracking-[0.18em] text-[--color-ink]">VEO</span>
      ) : null}
      <span className="veo-sr-only">VEO — learning you can see</span>
    </span>
  );
}
