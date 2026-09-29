/**
 * What a production deployment must have, and what it may do without.
 *
 * ## Why this is a module rather than a README section
 *
 * A checklist in prose gets out of date the release after it is written. This
 * is data, so `scripts/audit-config.mjs` can run it against a real
 * environment, the settings page can render the same classification, and a
 * test can assert that every integration VEO knows about appears exactly once.
 *
 * ## The classification is the whole point
 *
 * REQUIRED means VEO cannot serve accounts without it. A production
 * deployment missing one of these must fail visibly — `updateSession` refuses
 * protected routes with 503 and names the variables, rather than rendering
 * pages that happen to be empty because the database is absent.
 *
 * OPTIONAL means the product is coherent without it and says so. Without
 * Stripe, tiers resolve and allowances meter and enforce exactly as they do
 * with it; only starting a checkout is unavailable, and the plans page
 * disables the control rather than offering a button that fails. Without
 * OpenAI, the study controls are disabled with their reason on the label.
 * Without an anatomy source, Gate 9 stays RED and the viewport says why.
 *
 * Degrading honestly is not the same as degrading silently, and the
 * difference is what `severity` below encodes.
 */

export const CONFIG_CLASSES = ['required', 'optional'] as const;
export type ConfigClass = (typeof CONFIG_CLASSES)[number];

export interface ConfigRequirement {
  /** The integration, as somebody deploying VEO would name it. */
  readonly id: string;
  readonly label: string;
  readonly classification: ConfigClass;
  /**
   * Environment variables that must ALL be set for this to be configured.
   *
   * Names only. Nothing in VEO ever reports a value, including masked: a
   * masked secret in a page or a log is still a secret in a page or a log.
   */
  readonly variables: readonly string[];
  /** What works without it — empty for a required integration. */
  readonly degradesTo: string;
  /** Why it is classified this way. */
  readonly rationale: string;
}

export const CONFIG_REQUIREMENTS: readonly ConfigRequirement[] = [
  {
    id: 'supabase',
    label: 'Supabase — authentication, database and storage',
    classification: 'required',
    variables: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    degradesTo: '',
    rationale:
      'Identity, every persisted row and every RLS policy depend on it. Without it VEO has no way to know who is asking, so protected routes refuse rather than render.',
  },
  {
    id: 'app-url',
    label: 'Public application URL',
    classification: 'required',
    variables: ['NEXT_PUBLIC_APP_URL'],
    degradesTo: '',
    rationale:
      'Email confirmation, password reset and OAuth all redirect back to it. A wrong value sends a learner somewhere that cannot complete their sign-in, and the failure happens in their inbox rather than in a log.',
  },
  {
    id: 'supabase-admin',
    label: 'Supabase service role',
    classification: 'required',
    variables: ['SUPABASE_SERVICE_ROLE_KEY'],
    degradesTo: '',
    rationale:
      'Two operations legitimately bypass RLS: recording a verified Stripe subscription, and deleting an account. Without it VEO cannot delete an account at all, and refuses rather than half-deleting one.',
  },
  {
    id: 'stripe',
    label: 'Stripe — subscriptions',
    classification: 'optional',
    variables: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    degradesTo:
      'Tiers resolve, allowances meter and enforce. Only starting a checkout is unavailable, and the plans page says so with its upgrade controls disabled.',
    rationale:
      'Every free-tier learner gets the complete, correct product without it. A deployment that has not decided to charge yet is a normal state, not a broken one.',
  },
  {
    id: 'openai',
    label: 'OpenAI — tutor and content generation',
    classification: 'optional',
    variables: ['OPENAI_API_KEY'],
    degradesTo:
      'The study controls are disabled with their reason on the label, rather than present and failing when pressed.',
    rationale:
      'The spatial workspace, recall, analytics and billing are all complete without it.',
  },
  {
    id: 'anatomy',
    label: 'Licensed anatomy source',
    classification: 'optional',
    variables: ['ANATOMY_ASSET_BASE_URL'],
    degradesTo:
      'The viewport renders no geometry and says why. Gate 9 remains RED, which is the honest state and not a failure of configuration.',
    rationale:
      'VEO will not render a stand-in for an organ. An empty viewport that explains itself teaches nothing false; a primitive pretending to be anatomy does.',
  },
] as const;

/** Whether a set of present variable names satisfies a requirement. */
export function isSatisfied(
  requirement: ConfigRequirement,
  present: ReadonlySet<string>,
): boolean {
  return requirement.variables.every((name) => present.has(name));
}

export interface AuditFinding {
  readonly id: string;
  readonly label: string;
  readonly classification: ConfigClass;
  readonly satisfied: boolean;
  /** The variables this deployment is missing. Names only, never values. */
  readonly missing: readonly string[];
  /**
   * How bad this is.
   *
   * `blocking` — a required integration is missing; production must not serve.
   * `degraded` — an optional one is missing; the product is coherent and says so.
   * `ok`       — configured.
   */
  readonly severity: 'blocking' | 'degraded' | 'ok';
}

export function auditConfiguration(present: ReadonlySet<string>): readonly AuditFinding[] {
  return CONFIG_REQUIREMENTS.map((requirement) => {
    const missing = requirement.variables.filter((name) => !present.has(name));
    const satisfied = missing.length === 0;

    return {
      id: requirement.id,
      label: requirement.label,
      classification: requirement.classification,
      satisfied,
      missing,
      severity: satisfied
        ? 'ok'
        : requirement.classification === 'required'
          ? 'blocking'
          : 'degraded',
    };
  });
}

/** Whether this configuration may serve production at all. */
export function isProductionReady(findings: readonly AuditFinding[]): boolean {
  return findings.every((finding) => finding.severity !== 'blocking');
}
