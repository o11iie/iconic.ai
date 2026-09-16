import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/layout/AuthForm';
import { OAuthButtons } from '@/components/layout/OAuthButtons';
import { NotConfiguredState, Skeleton } from '@/components/ui/states';
import { capabilities } from '@/config/env';
import { LEGAL_LINKS } from '@/config/site';
import { signUpAction } from '../actions';
import { EMPTY_AUTH_STATE } from '../form-state';

export const metadata: Metadata = { title: 'Create account' };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Create your VEO account</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Learning you can see. Start with anatomy.
        </p>
      </header>

      {capabilities.supabase ? null : (
        <NotConfiguredState
          title="Authentication is not configured"
          description="This form is wired to Supabase Auth, but no Supabase project is attached to this environment, so submitting it will report an error rather than creating an account."
          requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
        />
      )}

      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <OAuthButtons />
        <AuthForm
          mode="signup"
          action={signUpAction}
          initialState={EMPTY_AUTH_STATE}
          submitLabel="Create account"
        />
      </Suspense>

      <p className="text-xs leading-relaxed text-ink-faint">
        By creating an account you agree to VEO&rsquo;s{' '}
        {LEGAL_LINKS.map((link, index) => (
          <span key={link.href}>
            <Link href={link.href} className="rounded text-ink-subtle underline hover:text-ink-muted">
              {link.label}
            </Link>
            {index < LEGAL_LINKS.length - 1 ? ' and ' : '.'}
          </span>
        ))}
      </p>

      <p className="text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="rounded font-medium text-cyan hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
