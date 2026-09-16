'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/states';
import { Icon } from '@/components/ui/Icon';
import type { AuthFormState } from '@/app/(auth)/form-state';

export type AuthFormMode = 'signin' | 'signup' | 'forgot' | 'reset';

/**
 * Shared credential form.
 *
 * Uses React 19's `useActionState`, so it posts to a server action and works
 * without JavaScript; the pending state is progressive enhancement rather than
 * a requirement. Errors render inline and are announced, never swallowed.
 */
export function AuthForm({
  mode,
  action,
  initialState,
  submitLabel,
  showForgotLink = false,
}: {
  readonly mode: AuthFormMode;
  readonly action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  readonly initialState: AuthFormState;
  readonly submitLabel: string;
  readonly showForgotLink?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const searchParams = useSearchParams();
  const next = searchParams.get('next');

  const wantsEmail = mode !== 'reset';
  const wantsPassword = mode === 'signin' || mode === 'signup' || mode === 'reset';

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {mode === 'signup' ? (
        <Input
          label="Name"
          name="displayName"
          type="text"
          autoComplete="name"
          required
          placeholder="Ada Lovelace"
        />
      ) : null}

      {wantsEmail ? (
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="you@university.edu"
        />
      ) : null}

      {wantsPassword ? (
        <div className="flex flex-col gap-1.5">
          <Input
            label={mode === 'reset' ? 'New password' : 'Password'}
            name="password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            {...(mode !== 'signin' ? { hint: 'At least 8 characters.' } : {})}
          />
          {showForgotLink ? (
            <Link
              href="/forgot-password"
              className="self-end rounded text-xs text-ink-subtle hover:text-cyan"
            >
              Forgot password?
            </Link>
          ) : null}
        </div>
      ) : null}

      {state.error ? <ErrorState title="Could not continue" description={state.error} /> : null}

      {state.notice ? (
        <p
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-cyan/25 bg-cyan/[0.06] p-3 text-sm leading-relaxed text-ink-muted"
        >
          <Icon name="mail" size={16} className="mt-0.5 shrink-0 text-cyan" />
          {state.notice}
        </p>
      ) : null}

      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
