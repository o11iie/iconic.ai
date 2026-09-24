import type { CapabilityView } from '@/billing/access';
import type { EntitlementKey, PlanTier } from '@/types/domain/billing';

/** What `/api/billing/status` returns. */
export interface BillingStatus {
  readonly ok: true;
  readonly tier: PlanTier;
  readonly capabilities: readonly CapabilityView[];
  readonly checkoutAvailable: boolean;
  readonly timeZone: string;
  /** What each tier grants, computed server-side by the one resolver. */
  readonly tiers: Readonly<Record<PlanTier, readonly EntitlementKey[]>>;
}

/**
 * How each capability is described to a learner.
 *
 * Plain language, and specific. "Advanced features" tells somebody nothing
 * about whether to pay; "Ask the tutor about any structure you have selected"
 * tells them exactly what they get.
 *
 * Kept beside the keys so a capability cannot be added to a plan without a
 * sentence explaining it — a pricing page with an unexplained row is a pricing
 * page nobody can act on.
 */
export const CAPABILITY_LABELS: Record<EntitlementKey, { title: string; detail: string }> = {
  'ai.tutor': {
    title: 'AI tutor',
    detail: 'Ask about any structure you have selected, grounded in the loaded model.',
  },
  'ai.generate_questions': {
    title: 'Generated questions',
    detail: 'Turn what you are looking at into questions that test you on it.',
  },
  'ai.generate_flashcards': {
    title: 'Generated flashcards',
    detail: 'Build flashcards from a structure and add them to your review schedule.',
  },
  'material.upload': {
    title: 'Upload your own material',
    detail: 'Bring in your own notes and study them alongside VEO’s models.',
  },
  'material.unlimited_uploads': {
    title: 'Unlimited uploads',
    detail: 'No daily cap on how much material you bring in.',
  },
  'spatial.premium_models': {
    title: 'Premium models',
    detail: 'Access to the full library of licensed spatial models.',
  },
  'spatial.unlimited_sessions': {
    title: 'Unlimited study sessions',
    detail: 'No cap on how long or how often you work in the 3D workspace.',
  },
  'recall.advanced_scheduling': {
    title: 'Advanced scheduling',
    detail: 'Tune how aggressively VEO brings material back.',
  },
  'export.notes': {
    title: 'Export your notes',
    detail: 'Take everything you have written with you.',
  },
};

export const TIER_LABELS: Record<PlanTier, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  institution: 'Institution',
};

export const TIER_SUMMARIES: Record<PlanTier, string> = {
  free: 'Everything you need to try VEO properly, with a daily allowance on the AI.',
  plus: 'The AI tutor and question generation, without a daily cap.',
  pro: 'Everything in Plus, plus the full model library and scheduling controls.',
  institution: 'Every capability, for teams and institutions.',
};

/**
 * A capability's allowance, in words.
 *
 * Returns null when there is nothing worth saying — an unmetered capability
 * needs no number beside it, and inventing "unlimited ∞" is noise.
 */
export function allowanceLabel(capability: CapabilityView): string | null {
  if (!capability.granted) return null;
  if (capability.limit === null) return null;

  return `${capability.remaining ?? 0} of ${capability.limit} left today`;
}

/** The remedy for a refusal, as a learner would act on it. */
export function remedyFor(capability: CapabilityView): string | null {
  switch (capability.denial) {
    case 'plan_required':
      return 'Included on a paid plan.';
    case 'quota_exhausted':
      return 'Resets tomorrow, or upgrade for no daily cap.';
    case 'unauthenticated':
      return 'Sign in to use this.';
    case 'not_configured':
      return 'Not available in this deployment.';
    default:
      return null;
  }
}
