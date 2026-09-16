'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { capabilities } from '@/config/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { domainsForOption, ONBOARDING_LEVELS } from '@/data/onboarding';
import type { OnboardingState } from './state';

/**
 * Persist onboarding answers to the learner's profile.
 *
 * Writes through the request-scoped client, so the update is subject to the
 * profiles RLS policy: a learner can only ever update their own row.
 */

const schema = z.object({
  displayName: z.string().trim().min(1, 'Enter a name.').max(80),
  domain: z.string().trim().min(1, 'Choose what you want to learn.'),
  level: z.enum(ONBOARDING_LEVELS.map((option) => option.value) as [string, ...string[]]),
  goal: z.string().trim().max(120).optional().or(z.literal('')),
});

export async function completeOnboardingAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = schema.safeParse({
    displayName: formData.get('displayName'),
    domain: formData.get('domain'),
    level: formData.get('level'),
    goal: formData.get('goal') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your answers.', saved: false };
  }

  if (!capabilities.supabase) {
    return {
      error:
        'Your answers could not be saved: this environment has no database connected. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable profiles.',
      saved: false,
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: 'Database is not configured.', saved: false };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Sign in to save your preferences.', saved: false };

  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: parsed.data.displayName,
      level: parsed.data.level as 'foundation' | 'intermediate' | 'advanced' | 'professional',
      interests: [...domainsForOption(parsed.data.domain)],
      onboarded_at: new Date().toISOString(),
      metadata: parsed.data.goal ? { learningGoal: parsed.data.goal } : {},
    })
    .eq('user_id', user.id);

  if (error) return { error: error.message, saved: false };

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
