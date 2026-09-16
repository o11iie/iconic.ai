import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/layout/AuthForm';
import { NotConfiguredState, Skeleton } from '@/components/ui/states';
import { capabilities } from '@/config/env';
import { signUpAction } from '../actions';
import { EMPTY_AUTH_STATE } from '../form-state';

export const metadata: Metadata = { title: 'Create account' };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Create your VEO account</h1>
        <p className="mt-1.5 text-sm text-[--color-ink-muted]">
          Learning you can see. Start with anatomy.
        </p>
      </div>

      {capabilities.supabase ? null : (
        <NotConfiguredState
          title="Authentication is not configured"
          description="This form is wired to Supabase Auth but this environment has no Supabase project attached, so submitting it will report an error rather than creating an account."
          requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
        />
      )}

      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <AuthForm
          mode="signup"
          action={signUpAction}
          initialState={EMPTY_AUTH_STATE}
          submitLabel="Create account"
        />
      </Suspense>

      <p className="text-sm text-[--color-ink-muted]">
        Already have an account?{' '}
        <Link href="/login" className="rounded text-[--color-cyan] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
