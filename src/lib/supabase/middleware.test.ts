import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthOnlyPath, isProtectedPath, PROTECTED_PREFIXES } from './middleware';

/**
 * Route protection, driven.
 *
 * The behaviour under test is the one Gate 15 changed: what happens to a
 * protected route when authentication is NOT configured.
 *
 * Before, `updateSession` returned early and let the request through. The
 * pages it let through leak nothing — with no Supabase there is no session
 * and no data — but that is a property of the outage, not of the code, and
 * one mistyped environment variable turned every protected route into an open
 * one. A production build must refuse; development must still render, so the
 * shell can be worked on before a database exists.
 */

const REQUEST_URL = 'https://veo.test';

/** A stand-in for NextRequest carrying only what `updateSession` reads. */
function request(pathname: string, search = '') {
  const url = new URL(`${REQUEST_URL}${pathname}${search}`);
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    cookies: { getAll: () => [], set: () => {} },
    headers: new Headers(),
  } as never;
}

/**
 * Load `updateSession` with Supabase configured or not, and with a chosen
 * NODE_ENV.
 *
 * Re-imported per case because both are read at module scope, which is
 * deliberate in the product: a production bundle's answer is fixed at build
 * time and cannot be flipped by a later environment edit.
 */
async function loadMiddleware({
  supabase,
  production,
}: {
  supabase: boolean;
  production: boolean;
}) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', production ? 'production' : 'development');

  vi.doMock('@/config/env', () => ({
    capabilities: { supabase },
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase ? 'https://project.supabase.co' : undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase ? 'anon-key' : undefined,
    },
  }));

  return import('./middleware');
}

describe('which paths are protected', () => {
  it('covers every surface that shows personal data', () => {
    for (const path of [
      '/dashboard',
      '/learn',
      '/recall',
      '/analytics',
      '/plans',
      '/library',
      '/settings',
      '/onboarding',
    ]) {
      expect(isProtectedPath(path), path).toBe(true);
      expect(isProtectedPath(`${path}/nested/deeper`), path).toBe(true);
    }
  });

  it('leaves the public surface public', () => {
    // /explore is Gate 2's deliberate product demonstration and must stay
    // reachable signed out.
    for (const path of ['/', '/login', '/signup', '/explore', '/legal/terms', '/api/health']) {
      expect(isProtectedPath(path), path).toBe(false);
    }
  });

  it('does not treat a lookalike prefix as protected', () => {
    // `/settings-export` is not inside `/settings`, and matching on a bare
    // prefix would have said it was.
    expect(isProtectedPath('/settings-export')).toBe(false);
    expect(isProtectedPath('/plansomething')).toBe(false);
  });

  it('sends a signed-in visitor away from the sign-in screens only', () => {
    expect(isAuthOnlyPath('/login')).toBe(true);
    expect(isAuthOnlyPath('/signup')).toBe(true);
    expect(isAuthOnlyPath('/forgot-password')).toBe(false);
    expect(isAuthOnlyPath('/reset-password')).toBe(false);
  });
});

describe('when authentication is not configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@/config/env');
    vi.resetModules();
  });

  it('a PRODUCTION build refuses every protected route', async () => {
    const { updateSession } = await loadMiddleware({ supabase: false, production: true });

    for (const path of PROTECTED_PREFIXES) {
      const response = await updateSession(request(path));
      expect(response.status, path).toBe(503);
    }
  });

  it('and says which variables are missing, never their values', async () => {
    const { updateSession } = await loadMiddleware({ supabase: false, production: true });

    const response = await updateSession(request('/dashboard'));
    const body = await response.text();

    expect(body).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(body).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    // The point of naming them is that an operator can act on it.
    expect(body).toMatch(/not configured/i);
    // No value of any kind.
    expect(body).not.toMatch(/eyJ|https:\/\/[a-z0-9]+\.supabase\.co/);
  });

  it('refuses rather than redirecting, because there is nowhere to sign in to', async () => {
    const { updateSession } = await loadMiddleware({ supabase: false, production: true });

    const response = await updateSession(request('/dashboard'));

    // A redirect to /login would send somebody to a form that cannot work.
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
    expect(response.headers.get('location')).toBeNull();
  });

  it('is never cached, so a fixed deployment recovers immediately', async () => {
    const { updateSession } = await loadMiddleware({ supabase: false, production: true });

    const response = await updateSession(request('/dashboard'));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('leaves public routes alone even in production', async () => {
    const { updateSession } = await loadMiddleware({ supabase: false, production: true });

    for (const path of ['/', '/login', '/explore', '/legal/privacy']) {
      const response = await updateSession(request(path));
      expect(response.status, path).toBe(200);
    }
  });

  it('a DEVELOPMENT build still renders, so the shell can be built first', async () => {
    const { updateSession } = await loadMiddleware({ supabase: false, production: false });

    const response = await updateSession(request('/dashboard'));
    expect(response.status).toBe(200);
  });
});
