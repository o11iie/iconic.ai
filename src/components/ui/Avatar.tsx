import { cn } from '@/lib/cn';

/** Deterministic initials so the same person always gets the same mark. */
function initialsFor(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split('@')[0] || '';
  if (!source) return '?';

  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function Avatar({
  name = null,
  email = null,
  src = null,
  size = 32,
  className,
}: {
  readonly name?: string | null;
  readonly email?: string | null;
  readonly src?: string | null;
  readonly size?: number;
  readonly className?: string;
}) {
  const initials = initialsFor(name, email);
  const label = name ?? email ?? 'Account';

  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center overflow-hidden rounded-full',
        'bg-surface-overlay text-ink ring-1 ring-hairline-strong',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden="true" className="font-medium tracking-wide">
          {initials}
        </span>
      )}
      <span className="veo-sr-only">{label}</span>
    </span>
  );
}
