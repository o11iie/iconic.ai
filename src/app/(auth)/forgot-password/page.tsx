import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/layout/AuthForm';
import { NotConfiguredState, Skeleton } from '@/components/ui/states';
import { capabilities } from '@/config/env';
import { requestPasswordResetAction } from '../actions';
import { EMPTY_AUTH_STATE } from '../form-state';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          Enter your email and we&rsquo;ll send a link to set a new password.
        </p>
      </header>

      {capabilities.supabase ? null : (
        <NotConfiguredState
          title="Authentication is not configured"
          description="Password reset is wired to Supabase Auth, but no Supabase project is attached to this environment."
          requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
        />
      )}

      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <AuthForm
          mode="forgot"
          action={requestPasswordResetAction}
          initialState={EMPTY_AUTH_STATE}
          submitLabel="Send reset link"
        />
      </Suspense>

      <p className="text-sm text-ink-muted">
        <Link href="/login" className="rounded font-medium text-cyan hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
