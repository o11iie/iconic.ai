import { describe, expect, it } from 'vitest';
import {
  auditConfiguration,
  CONFIG_REQUIREMENTS,
  isProductionReady,
  isSatisfied,
} from './production-audit';

const ALL = new Set(CONFIG_REQUIREMENTS.flatMap((requirement) => requirement.variables));

function without(...names: string[]): Set<string> {
  const present = new Set(ALL);
  for (const name of names) present.delete(name);
  return present;
}

describe('classifying a deployment', () => {
  it('reports a fully configured deployment as production ready', () => {
    const findings = auditConfiguration(ALL);

    expect(findings.every((finding) => finding.satisfied)).toBe(true);
    expect(isProductionReady(findings)).toBe(true);
  });

  it('blocks production when authentication is missing', () => {
    const findings = auditConfiguration(without('NEXT_PUBLIC_SUPABASE_URL'));
    const supabase = findings.find((finding) => finding.id === 'supabase');

    expect(supabase?.severity).toBe('blocking');
    expect(supabase?.missing).toEqual(['NEXT_PUBLIC_SUPABASE_URL']);
    expect(isProductionReady(findings)).toBe(false);
  });

  it('blocks production when accounts could not be deleted', () => {
    // Half a lifecycle is not a lifecycle: a deployment that can create
    // accounts and not remove them cannot honour a deletion request.
    const findings = auditConfiguration(without('SUPABASE_SERVICE_ROLE_KEY'));

    expect(findings.find((f) => f.id === 'supabase-admin')?.severity).toBe('blocking');
    expect(isProductionReady(findings)).toBe(false);
  });

  it('does NOT block production when Stripe is missing', () => {
    const findings = auditConfiguration(
      without('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'),
    );
    const stripe = findings.find((finding) => finding.id === 'stripe');

    expect(stripe?.severity).toBe('degraded');
    expect(stripe?.satisfied).toBe(false);
    // The product is coherent without it: tiers resolve, allowances enforce,
    // and only checkout is unavailable.
    expect(isProductionReady(findings)).toBe(true);
  });

  it('does NOT block production when the AI or anatomy source is missing', () => {
    const findings = auditConfiguration(
      without('OPENAI_API_KEY', 'ANATOMY_ASSET_BASE_URL'),
    );

    expect(findings.find((f) => f.id === 'openai')?.severity).toBe('degraded');
    expect(findings.find((f) => f.id === 'anatomy')?.severity).toBe('degraded');
    expect(isProductionReady(findings)).toBe(true);
  });

  it('needs every variable of a requirement, not just one', () => {
    const stripe = CONFIG_REQUIREMENTS.find((r) => r.id === 'stripe')!;

    expect(isSatisfied(stripe, new Set(['STRIPE_SECRET_KEY']))).toBe(false);
    expect(
      isSatisfied(stripe, new Set(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'])),
    ).toBe(true);
  });

  it('reports a bare empty environment as blocked, not merely degraded', () => {
    const findings = auditConfiguration(new Set());

    expect(isProductionReady(findings)).toBe(false);
    expect(findings.filter((f) => f.severity === 'blocking').length).toBeGreaterThan(0);
  });
});

describe('the classification itself', () => {
  it('names variables for every requirement', () => {
    for (const requirement of CONFIG_REQUIREMENTS) {
      expect(requirement.variables.length, requirement.id).toBeGreaterThan(0);
    }
  });

  it('gives every optional integration an honest degraded mode', () => {
    for (const requirement of CONFIG_REQUIREMENTS.filter((r) => r.classification === 'optional')) {
      expect(requirement.degradesTo.length, requirement.id).toBeGreaterThan(20);
    }
  });

  it('claims no degraded mode for anything required, because there is not one', () => {
    for (const requirement of CONFIG_REQUIREMENTS.filter((r) => r.classification === 'required')) {
      expect(requirement.degradesTo, requirement.id).toBe('');
    }
  });

  it('classifies every secret VEO actually reads', () => {
    for (const name of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'OPENAI_API_KEY',
    ]) {
      expect(ALL.has(name), name).toBe(true);
    }
  });

  it('lists nothing twice', () => {
    const ids = CONFIG_REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never carries a value, only a name', () => {
    // A classification that quoted an example key would put one in the repo.
    const serialised = JSON.stringify(CONFIG_REQUIREMENTS);
    expect(serialised).not.toMatch(/sk_(live|test)_|whsec_|\bsk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9]/);
  });
});
