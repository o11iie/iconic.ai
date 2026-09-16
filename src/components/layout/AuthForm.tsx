'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/states';
import type { AuthFormState } from '@/app/(auth)/form-state';

/**
 * Shared credential form for sign in and sign up.
 *
 * Uses React 19's `useActionState`, so the form posts to a server action and
 * works without JavaScript; the pending state is progressive enhancement
 * rather than a requirement.
 */
export function AuthForm({
  mode,
  action,
  initialState,
  submitLabel,
}: {
  readonly mode: 'signin' | 'signup';
  readonly action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  readonly initialState: AuthFormState;
  readonly submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const searchParams = useSearchParams();
  const next = searchParams.get('next');

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

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        placeholder="you@university.edu"
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
        minLength={8}
        {...(mode === 'signup' ? { hint: 'At least 8 characters.' } : {})}
      />

      {state.error ? <ErrorState title="Could not continue" description={state.error} /> : null}

      {state.notice ? (
        <p
          role="status"
          className="rounded-lg border border-[--color-cyan]/25 bg-[--color-cyan]/[0.06] p-3 text-sm leading-relaxed text-[--color-ink-muted]"
        >
          {state.notice}
        </p>
      ) : null}

      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
