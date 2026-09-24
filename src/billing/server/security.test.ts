import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
// Erased at compile time, so importing these here executes nothing — they
// exist only to type `importOriginal` without an inline `import()` annotation.
import type * as EntitlementsModule from './entitlements';
import type * as StubModule from '@/ai/providers/verification-stub';
import { join } from 'node:path';

/**
 * The billing security boundary.
 *
 * The property under test is one sentence: a client cannot grant itself a
 * plan, and cannot spend more than its plan allows. Everything below attacks
 * that from a different direction.
 *
 * The database half — that `subscriptions` and `entitlement_usage` have no
 * client write policy, and that `consume_entitlement` refuses the eleventh
 * caller atomically — is proved against real PostgreSQL by verify-rls.sh.
 * These cover the application half.
 */

/**
 * A file's code, without its prose.
 *
 * Every scan below uses this. Two checks in the first draft failed against
 * comments explaining why the code does NOT do the thing being scanned for —
 * the checkout route's note about never accepting an amount, and the stub's
 * note about never using a computed env key. A scan that reads documentation
 * as evidence proves nothing about behaviour.
 */
function codeOf(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const mockResolve = vi.fn();
const mockConsume = vi.fn();
const mockStub = vi.fn(() => false);

vi.mock('./entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof EntitlementsModule>();
  return {
    ...actual,
    resolveAccess: () => mockResolve(),
    consume: (...args: unknown[]) => mockConsume(...args),
  };
});

vi.mock('@/ai/providers/verification-stub', async (importOriginal) => {
  const actual = await importOriginal<typeof StubModule>();
  return { ...actual, stubEnabled: () => mockStub() };
});

const { requireEntitlement } = await import('./gate');

beforeEach(() => {
  mockResolve.mockReset();
  mockConsume.mockReset();
  mockStub.mockReset();
  mockStub.mockReturnValue(false);
});

const ACCESS = { userId: 'alice', tier: 'free', entitlements: [], usageDate: '2026-09-24' };

describe('the gate refuses before it works', () => {
  it('refuses an unauthenticated caller with 401', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'unauthenticated' });

    const result = await requireEntitlement('ai.tutor');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.response.status).toBe(401);
      expect(result.failure.reason).toBe('unauthenticated');
    }
    // Nothing was spent on somebody who was never allowed to spend.
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('refuses a capability the plan does not include with 403', async () => {
    mockResolve.mockResolvedValue({ ok: true, access: ACCESS });
    mockConsume.mockResolvedValue({ allowed: false, reason: 'plan_required', tier: 'free', quota: null });

    const result = await requireEntitlement('ai.tutor');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.response.status).toBe(403);
  });

  it('refuses a spent allowance with 429, which says "try later"', async () => {
    mockResolve.mockResolvedValue({ ok: true, access: ACCESS });
    mockConsume.mockResolvedValue({
      allowed: false,
      reason: 'quota_exhausted',
      tier: 'free',
      quota: { key: 'ai.generate_flashcards', limit: 10, used: 10, remaining: 0, exhausted: true },
    });

    const result = await requireEntitlement('ai.generate_flashcards');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.response.status).toBe(429);
      const body = await result.failure.response.json();
      // The UI needs the numbers to explain the refusal.
      expect(body.error.quota.remaining).toBe(0);
    }
  });

  it('spends exactly once for one allowed request', async () => {
    mockResolve.mockResolvedValue({ ok: true, access: ACCESS });
    mockConsume.mockResolvedValue({ allowed: true, tier: 'free', quota: null });

    const result = await requireEntitlement('ai.generate_flashcards');
    expect(result.ok).toBe(true);
    expect(mockConsume).toHaveBeenCalledTimes(1);
  });

  it('spends BEFORE the work, so a failure loop cannot be free', async () => {
    // Refunding on provider failure would hand anybody an unlimited allowance
    // by way of a malformed request.
    mockResolve.mockResolvedValue({ ok: true, access: ACCESS });
    mockConsume.mockResolvedValue({ allowed: true, tier: 'free', quota: null });

    await requireEntitlement('ai.generate_flashcards');
    expect(mockConsume).toHaveBeenCalledTimes(1);

    const [, key] = mockConsume.mock.calls[0]!;
    expect(key).toBe('ai.generate_flashcards');
  });

  it('refuses rather than granting free usage when the counter is unhealthy', async () => {
    // The safe direction. If usage cannot be recorded, the allowance must not
    // quietly become unlimited.
    mockResolve.mockResolvedValue({ ok: true, access: ACCESS });
    mockConsume.mockResolvedValue({ allowed: false, reason: 'not_configured', tier: 'free', quota: null });

    const result = await requireEntitlement('ai.generate_flashcards');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.response.status).toBe(503);
  });

  it('leaks nothing about the account in a refusal', async () => {
    mockResolve.mockResolvedValue({ ok: true, access: ACCESS });
    mockConsume.mockResolvedValue({ allowed: false, reason: 'plan_required', tier: 'free', quota: null });

    const result = await requireEntitlement('ai.tutor');
    if (!result.ok) {
      const text = JSON.stringify(await result.failure.response.json());
      expect(text).not.toContain('alice');
      expect(text).not.toContain('stripe');
      expect(text).not.toContain('subscriptions');
    }
  });
});

describe('the verification stub exemption', () => {
  it('serves stub content without an account', async () => {
    mockStub.mockReturnValue(true);

    const result = await requireEntitlement('ai.tutor');
    expect(result.ok).toBe(true);
    // No subscription was even looked up: there is nothing to bill.
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('cannot be reached when a real provider is configured', () => {
    // The guarantee that makes the exemption safe rather than a bypass. Both
    // halves live in Gate 10's stub and are asserted here because Gate 14 now
    // depends on them for a security property.
    const code = codeOf('src/ai/providers/verification-stub.ts');

    // A LITERAL read, so Next inlines it at build time — a bundle built
    // without the flag has no branch to enable.
    expect(code).toContain("process.env.VEO_TUTOR_STUB !== '1'");
    expect(code).not.toMatch(/process\.env\[/);

    // And it refuses outright whenever a real key exists.
    expect(code).toContain('OPENAI_API_KEY');
    expect(code).toContain("return typeof key !== 'string' || key.trim().length === 0;");
  });

  it('the gate documents why the exemption is not an auth bypass', () => {
    const source = readFileSync(join(process.cwd(), 'src/billing/server/gate.ts'), 'utf8');
    expect(source).toContain('stubEnabled');
    expect(source).toMatch(/BUILD time/);
  });
});

describe('every paid action is behind the gate', () => {
  const AI_ROUTES = [
    ['tutor', 'src/app/api/ai/tutor/route.ts', 'ai.tutor'],
    // Questions and flashcards share one handler, which picks the key from
    // the content type the ROUTE forces — never from the body.
    ['generation', 'src/ai/learning/generation-route.ts', 'ai.generate_'],
  ] as const;

  it('gates every AI entry point', () => {
    for (const [name, path, key] of AI_ROUTES) {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      expect(source, `${name} is not gated`).toContain('requireEntitlement');
      expect(source, `${name} names no entitlement`).toContain(key);
    }
  });

  it('gates before parsing the body, so an unentitled flood is cheap', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/ai/tutor/route.ts'), 'utf8');
    const gateAt = source.indexOf('requireEntitlement');
    const parseAt = source.indexOf('await request.json()');

    expect(gateAt).toBeGreaterThan(-1);
    expect(parseAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(parseAt);
  });

  it('scan control: the scan DOES notice an ungated route', () => {
    const planted = `export async function POST(request: Request) { return handle(request); }`;
    expect(planted).not.toContain('requireEntitlement');
  });

  it('leaves no AI route reachable without passing through the gate', () => {
    // A new AI route added later must not be quietly exempt.
    const dir = join(process.cwd(), 'src/app/api/ai');
    const names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    expect(names.length).toBeGreaterThanOrEqual(3); // positive control

    for (const entry of names) {
      const source = readFileSync(join(dir, entry.name, 'route.ts'), 'utf8');
      const gated =
        source.includes('requireEntitlement') || source.includes('handleGeneration');
      expect(gated, `${entry.name} is reachable without the gate`).toBe(true);
    }
  });
});

describe('the client cannot name its own price', () => {
  it('checkout accepts a tier from a closed set, never a price', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/billing/checkout/route.ts'),
      'utf8',
    );

    expect(source).toContain('PLAN_TIERS');
    expect(source).toContain('.strict()');

    // A browser that could name a sum could buy an institution plan for a
    // penny, and validating a client-supplied number is never as safe as not
    // accepting one.
    //
    // Comments are stripped before scanning: the first version of this check
    // failed against the route's own prose explaining why it accepts no such
    // field, which proves nothing about the code.
    const code = codeOf('src/app/api/billing/checkout/route.ts');

    expect(code).toContain('PLAN_TIERS'); // positive control: code survived
    expect(code).not.toMatch(/\bamount\b|\bprice_id\b|\bunit_amount\b|\bcurrency\b/);
  });

  it('checkout excludes the free tier, which cannot be bought', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/billing/checkout/route.ts'),
      'utf8',
    );
    expect(source).toMatch(/tier !== 'free'/);
  });
});

describe('the webhook is the only path that grants a plan', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/api/billing/webhook/route.ts'),
    'utf8',
  );

  it('verifies the signature before reading anything from the body', () => {
    const verifyAt = source.indexOf('constructWebhookEvent');
    const readAt = source.indexOf('event.data.object');

    expect(verifyAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(verifyAt);
  });

  it('reads the RAW body, since the signature covers exact bytes', () => {
    expect(source).toContain('request.text()');
    expect(source).not.toContain('request.json()');
  });

  it('takes the tier from metadata VEO set, not from a price or product name', () => {
    // Price ids and product names are configured in a dashboard and can be
    // renamed by anyone with Stripe access.
    expect(source).toContain('veo_tier');
    expect(source).toContain('PLAN_TIERS');
  });

  it('grants nothing when the tier or status is unrecognised', () => {
    expect(source).toMatch(/if \(!tier \|\| !status\)/);
  });

  it('is the only route that uses the service role', () => {
    const dir = join(process.cwd(), 'src/app/api');
    const offenders: string[] = [];

    const walk = (current: string) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'route.ts') {
          const text = readFileSync(full, 'utf8');
          if (text.includes('getSupabaseAdminClient')) offenders.push(full);
        }
      }
    };
    walk(dir);

    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain('billing/webhook');
  });

  it('is idempotent, because Stripe redelivers', () => {
    expect(source).toContain('upsert');
    expect(source).toContain("onConflict: 'user_id'");
  });

  it('copies nothing from the payload into VEO\'s own metadata', () => {
    expect(source).toMatch(/metadata: \{\}/);
  });
});

describe('subscriptions remain unwritable by clients', () => {
  it('the migration adds no write policy', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/0004_entitlement_usage.sql'),
      'utf8',
    );

    // Gate 14 must not add a convenience policy to the table whose lack of one
    // is the entire reason a plan cannot be self-granted.
    expect(migration).not.toMatch(/create policy[\s\S]{0,120}on public\.subscriptions[\s\S]{0,60}for (insert|update|delete)/i);
    expect(migration).toContain('Gate 14 does not add one');
  });

  it('entitlement_usage has a select policy and no write policy', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/0004_entitlement_usage.sql'),
      'utf8',
    );

    expect(migration).toContain('entitlement_usage_select_own');
    expect(migration).not.toMatch(/create policy[^;]*entitlement_usage[^;]*for (insert|update|delete)/i);
    // The function that writes it establishes identity itself.
    expect(migration).toContain('security definer');
    expect(migration).toContain('auth.uid()');
  });

  it('consume_entitlement takes no user id to forge', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/0004_entitlement_usage.sql'),
      'utf8',
    );
    const signature = migration.slice(
      migration.indexOf('create or replace function public.consume_entitlement'),
      migration.indexOf('returns table'),
    );

    expect(signature).not.toMatch(/user_id|p_user/i);
  });
});
