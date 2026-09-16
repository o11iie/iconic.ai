import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/layout/AuthForm';
import { OAuthButtons } from '@/components/layout/OAuthButtons';
import { NotConfiguredState, Skeleton } from '@/components/ui/states';
import { capabilities } from '@/config/env';
import { signInAction } from '../actions';
import { EMPTY_AUTH_STATE } from '../form-state';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to VEO</h1>
        <p className="mt-1.5 text-sm text-ink-muted">Pick up where you left off.</p>
      </header>

      {capabilities.supabase ? null : (
        <NotConfiguredState
          title="Authentication is not configured"
          description="This form is wired to Supabase Auth, but no Supabase project is attached to this environment, so submitting it will report an error rather than signing you in."
          requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
        />
      )}

      {/* useSearchParams requires a Suspense boundary during prerendering. */}
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <OAuthButtons />
        <AuthForm
          mode="signin"
          action={signInAction}
          initialState={EMPTY_AUTH_STATE}
          submitLabel="Continue"
          showForgotLink
        />
      </Suspense>

      <p className="text-sm text-ink-muted">
        New to VEO?{' '}
        <Link href="/signup" className="rounded font-medium text-cyan hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
