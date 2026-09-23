import type { SVGProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * VEO icon set.
 *
 * Inline SVG rather than an icon dependency: the set is small, every glyph is
 * drawn on the same 24px grid with the same 1.5 stroke, and shipping it inline
 * costs no extra network request and no unused bundle weight.
 *
 * Icons are decorative by default (`aria-hidden`). Anything that carries
 * meaning must be labelled by its parent control.
 */

export type IconName =
  | 'home'
  | 'learn'
  | 'explore'
  | 'recall'
  | 'library'
  | 'settings'
  | 'search'
  | 'user'
  | 'logout'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronLeft'
  | 'close'
  | 'menu'
  | 'check'
  | 'plus'
  | 'select'
  | 'orbit'
  | 'layers'
  | 'isolate'
  | 'reset'
  | 'sparkles'
  | 'quiz'
  | 'flashcard'
  | 'note'
  | 'clock'
  | 'info'
  | 'alert'
  | 'link'
  | 'lock'
  | 'mail'
  | 'bell'
  | 'shield'
  | 'card'
  | 'palette'
  | 'arrowRight'
  | 'peel'
  | 'dissect'
  | 'explode'
  | 'ghost'
  | 'eyeOff'
  | 'undo'
  | 'redo'
  | 'rebuild'
  | 'insights';

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3.5 10.5 12 3.75l8.5 6.75V20a.75.75 0 0 1-.75.75h-4.5v-6h-6.5v6h-4.5A.75.75 0 0 1 3.5 20v-9.5Z" />,
  learn: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </>
  ),
  explore: (
    <>
      <path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6L12 3.2Z" />
      <path d="M4 7.6 12 12m0 0 8-4.4M12 12v8.8" />
    </>
  ),
  recall: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.2h-4.2" />
    </>
  ),
  library: <path d="M6 3.75h12a.75.75 0 0 1 .75.75v15.06a.4.4 0 0 1-.62.33L12 15.9l-6.13 3.99a.4.4 0 0 1-.62-.33V4.5A.75.75 0 0 1 6 3.75Z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.75v2.1M12 19.15v2.1M4.4 4.4l1.5 1.5M18.1 18.1l1.5 1.5M2.75 12h2.1M19.15 12h2.1M4.4 19.6l1.5-1.5M18.1 5.9l1.5-1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4.75H6.5a1.75 1.75 0 0 0-1.75 1.75v11a1.75 1.75 0 0 0 1.75 1.75h8" />
      <path d="M16.5 8.5 20 12l-3.5 3.5M20 12h-9.5" />
    </>
  ),
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronRight: <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  chevronLeft: <path d="M14.5 6.5 9 12l5.5 5.5" />,
  close: <path d="m6.5 6.5 11 11m0-11-11 11" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  select: <path d="m6 4 12.5 7.2-5.3 1.1-1.1 5.3L6 4Z" />,
  orbit: (
    <>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M5.4 8.2c-1.6 2.2-2 4.3-.9 5.4 1.6 1.6 5.9-.1 9.6-3.8s5.4-8 3.8-9.6" transform="translate(0 4.4)" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.25 4.25L12 12 3.75 7.75 12 3.5Z" />
      <path d="m4.5 12 7.5 3.9 7.5-3.9M4.5 16.25l7.5 3.9 7.5-3.9" />
    </>
  ),
  isolate: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M4 4h3M20 4h-3M4 20h3M20 20h-3M4 4v3M20 4v3M4 20v-3M20 20v-3" />
    </>
  ),
  reset: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 4v4.2h4.2" />
    </>
  ),
  peel: (
    <>
      <path d="M4 7.5 12 4l8 3.5-8 3.5L4 7.5Z" />
      <path d="M6.5 13.2 12 15.6l5.5-2.4M7.5 17.4l4.5 2 4.5-2" />
    </>
  ),
  dissect: (
    <>
      <path d="M5 4.5 13.5 13M19 4.5 10.5 13" />
      <circle cx="8" cy="17" r="2.5" />
      <circle cx="16" cy="17" r="2.5" />
    </>
  ),
  explode: (
    <>
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M12 7V3.5M12 17v3.5M7 12H3.5M17 12h3.5" />
    </>
  ),
  ghost: (
    <>
      <circle cx="12" cy="12" r="7.5" strokeDasharray="3 2.5" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 12s3.2-5.5 8-5.5c1.4 0 2.6.4 3.7 1M20 12s-3.2 5.5-8 5.5c-1.5 0-2.8-.5-3.9-1.2" />
      <path d="M4.5 4.5l15 15" />
    </>
  ),
  undo: (
    <>
      <path d="M4 10h9a5 5 0 0 1 0 10h-3" />
      <path d="M7.5 6.5 4 10l3.5 3.5" />
    </>
  ),
  redo: (
    <>
      <path d="M20 10h-9a5 5 0 0 0 0 10h3" />
      <path d="M16.5 6.5 20 10l-3.5 3.5" />
    </>
  ),
insights: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
    rebuild: (
    <>
      <path d="M12 3.5 19 7.5v9L12 20.5 5 16.5v-9L12 3.5Z" />
      <path d="M12 12v8.5M12 12 5 7.5M12 12l7-4.5" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
    </>
  ),
  quiz: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M9.9 9.4a2.2 2.2 0 1 1 2.9 2.4c-.5.2-.8.7-.8 1.2v.5" />
      <path d="M12 16.6h.01" />
    </>
  ),
  flashcard: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M8 10h8M8 14h5" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.75h9.5L19 9.25V19a.75.75 0 0 1-.75.75H5A.75.75 0 0 1 4.25 19V5.5A.75.75 0 0 1 5 4.75Z" />
      <path d="M14 4.75V9.5h4.75" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 11v5.2M12 7.9h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.6 21 19.4H3L12 4.6Z" />
      <path d="M12 10.2v3.6M12 16.6h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.54 3.54 0 0 0-5-5L11.75 7.2" />
      <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.54 3.54 0 0 0 5 5l1.25-1.2" />
    </>
  ),
  lock: (
    <>
      <rect x="4.75" y="10.5" width="14.5" height="9" rx="1.75" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.5 0v2.75" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7 8 5.5L20 7" />
    </>
  ),
  bell: (
    <>
      <path d="M17.5 11a5.5 5.5 0 1 0-11 0c0 4-1.5 5.25-1.5 5.25h14S17.5 15 17.5 11Z" />
      <path d="M13.7 19.5a2 2 0 0 1-3.4 0" />
    </>
  ),
  shield: <path d="M12 3.5 19 6v5.6c0 4.2-2.8 7.4-7 8.9-4.2-1.5-7-4.7-7-8.9V6l7-2.5Z" />,
  card: (
    <>
      <rect x="3" y="5.75" width="18" height="12.5" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.75a8.25 8.25 0 0 0 0 16.5c1 0 1.6-.7 1.6-1.5 0-.5-.2-.8-.5-1.1a1.4 1.4 0 0 1 1-2.4h1.6a4.55 4.55 0 0 0 4.55-4.6c0-4-3.7-6.9-8.25-6.9Z" />
      <path d="M7.5 11.5h.01M10 8h.01M14.5 8h.01" />
    </>
  ),
  arrowRight: <path d="M4.5 12h15m0 0-5.5-5.5M19.5 12 14 17.5" />,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  readonly name: IconName;
  readonly size?: number;
  /** Provide only when the icon is the sole carrier of meaning. */
  readonly title?: string;
}

export function Icon({ name, size = 20, className, title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={cn('shrink-0', className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
