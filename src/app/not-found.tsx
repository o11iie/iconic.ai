import { Logo } from '@/components/layout/Logo';
import { ButtonLink } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-5 px-6">
      <Logo />
      <div>
        <p className="font-mono text-xs tracking-widest text-ink-faint">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page does not exist</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          The link may be out of date, or the subject may not have been published yet.
        </p>
      </div>
      <ButtonLink href="/" className="mt-1">
        Back to VEO
      </ButtonLink>
    </div>
  );
}
