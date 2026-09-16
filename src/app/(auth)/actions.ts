'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { capabilities, env } from '@/config/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { AuthFormState } from './form-state';

/**
 * Authentication server actions.
 *
 * These run only on the server, so credentials are never handled in the
 * browser beyond the form POST itself. Errors are returned as state rather
 * than thrown, so the form can render them inline.
 */

const credentialsSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(8, 'Passwords must be at least 8 characters.'),
});

const signUpSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1, 'Enter a name.').max(80),
});

/** Only allow same-origin relative paths, so `?next=` cannot be an open redirect. */
function safeRedirect(value: FormDataEntryValue | null, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

const NOT_CONFIGURED =
  'Authentication is not configured in this environment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.';

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!capabilities.supabase) return { error: NOT_CONFIGURED, notice: null };

  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details.', notice: null };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NOT_CONFIGURED, notice: null };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately does not distinguish "no such user" from "wrong password":
    // that difference is an account-enumeration oracle.
    return { error: 'Those details did not match an account.', notice: null };
  }

  revalidatePath('/', 'layout');
  redirect(safeRedirect(formData.get('next')));
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!capabilities.supabase) return { error: NOT_CONFIGURED, notice: null };

  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    displayName: formData.get('displayName'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details.', notice: null };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NOT_CONFIGURED, notice: null };

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/onboarding`,
    },
  });

  if (error) {
    return { error: error.message, notice: null };
  }

  // When email confirmation is on, there is no session yet. Say so plainly
  // rather than redirecting to a page that will bounce them back.
  if (!data.session) {
    return {
      error: null,
      notice: `Check ${parsed.data.email} for a confirmation link to finish creating your account.`,
    };
  }

  revalidatePath('/', 'layout');
  redirect('/onboarding');
}

/**
 * Begin an OAuth flow.
 *
 * Supabase returns a provider URL to redirect to; the callback route then
 * exchanges the returned code for a session. Providers must be enabled in the
 * Supabase dashboard as well as listed in NEXT_PUBLIC_OAUTH_PROVIDERS.
 */
export async function signInWithOAuthAction(formData: FormData): Promise<void> {
  const provider = formData.get('provider');
  if (typeof provider !== 'string' || !env.NEXT_PUBLIC_OAUTH_PROVIDERS.includes(provider)) {
    redirect('/login?error=unsupported_provider');
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect('/login?error=not_configured');

  const next = safeRedirect(formData.get('next'));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as Parameters<typeof supabase.auth.signInWithOAuth>[0]['provider'],
    options: {
      redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) redirect('/login?error=oauth_failed');
  redirect(data.url);
}

/** Send a password-reset email. */
export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!capabilities.supabase) return { error: NOT_CONFIGURED, notice: null };

  const parsed = z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .safeParse(formData.get('email'));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a valid email.', notice: null };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NOT_CONFIGURED, notice: null };

  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
  });

  // Always the same response, whether or not the address has an account:
  // differing here would let an attacker enumerate registered emails.
  return {
    error: null,
    notice: `If an account exists for ${parsed.data}, a reset link is on its way.`,
  };
}

/** Set a new password for the user in the current recovery session. */
export async function updatePasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!capabilities.supabase) return { error: NOT_CONFIGURED, notice: null };

  const parsed = z
    .string()
    .min(8, 'Passwords must be at least 8 characters.')
    .safeParse(formData.get('password'));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your password.', notice: null };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NOT_CONFIGURED, notice: null };

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: error.message, notice: null };

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  redirect('/');
}
