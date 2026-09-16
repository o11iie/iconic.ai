import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/layout/AuthForm';
import { Skeleton } from '@/components/ui/states';
import { updatePasswordAction } from '../actions';
import { EMPTY_AUTH_STATE } from '../form-state';

export const metadata: Metadata = { title: 'Set a new password' };

/**
 * Completes the recovery flow.
 *
 * Reached from the emailed link, which lands on /auth/callback first; that
 * route exchanges the recovery code for a session before redirecting here, so
 * `updateUser` runs as the authenticated user.
 */
export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          Choose a password you have not used elsewhere.
        </p>
      </header>

      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <AuthForm
          mode="reset"
          action={updatePasswordAction}
          initialState={EMPTY_AUTH_STATE}
          submitLabel="Save password"
        />
      </Suspense>
    </div>
  );
}
