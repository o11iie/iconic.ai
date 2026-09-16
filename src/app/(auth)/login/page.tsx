import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/layout/AuthForm';
import { NotConfiguredState, Skeleton } from '@/components/ui/states';
import { capabilities } from '@/config/env';
import { signInAction } from '../actions';
import { EMPTY_AUTH_STATE } from '../form-state';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in to VEO</h1>
        <p className="mt-1.5 text-sm text-[--color-ink-muted]">
          Pick up where you left off.
        </p>
      </div>

      {capabilities.supabase ? null : (
        <NotConfiguredState
          title="Authentication is not configured"
          description="The sign-in form below is wired to Supabase Auth but this environment has no Supabase project attached, so submitting it will report an error rather than signing you in."
          requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
        />
      )}

      {/* useSearchParams requires a Suspense boundary during prerendering. */}
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AuthForm
          mode="signin"
          action={signInAction}
          initialState={EMPTY_AUTH_STATE}
          submitLabel="Sign in"
        />
      </Suspense>

      <p className="text-sm text-[--color-ink-muted]">
        New to VEO?{' '}
        <Link href="/signup" className="rounded text-[--color-cyan] hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
