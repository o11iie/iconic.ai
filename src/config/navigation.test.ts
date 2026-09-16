import { describe, expect, it } from 'vitest';
import { APP_NAV, SECONDARY_NAV, LEGAL_LINKS, LEARNING_LOOP } from './site';
import { PROTECTED_PREFIXES, isProtectedPath, isAuthOnlyPath } from '@/lib/supabase/middleware';

describe('navigation', () => {
  it('exposes exactly the five primary learning surfaces', () => {
    expect(APP_NAV.map((item) => item.label)).toEqual([
      'Home',
      'Learn',
      'Explore',
      'Recall',
      'Library',
    ]);
  });

  it('keeps Settings out of the primary rail', () => {
    expect(APP_NAV.some((item) => item.href === '/settings')).toBe(false);
    expect(SECONDARY_NAV.some((item) => item.href === '/settings')).toBe(true);
  });

  it('gives every nav item an icon and a destination', () => {
    for (const item of [...APP_NAV, ...SECONDARY_NAV]) {
      expect(item.icon.length).toBeGreaterThan(0);
      expect(item.href.startsWith('/')).toBe(true);
    }
  });

  it('marks only Explore as carrying spatial context across navigation', () => {
    const carriers = APP_NAV.filter((item) => item.preservesSpatialContext).map((i) => i.href);
    expect(carriers).toEqual(['/explore']);
  });

  it('protects every personal surface behind authentication', () => {
    // Everything that reads or writes a learner's own data requires a session.
    const personal = [...APP_NAV, ...SECONDARY_NAV].filter((item) => item.href !== '/explore');
    for (const item of personal) {
      expect(isProtectedPath(item.href)).toBe(true);
    }
    expect(PROTECTED_PREFIXES.length).toBeGreaterThan(0);
  });

  it('leaves the workspace publicly reachable as the product demonstration', () => {
    // The landing page's "Explore VEO" call to action must not hit a login
    // wall. The workspace exposes no personal data when signed out.
    expect(isProtectedPath('/explore')).toBe(false);
  });

  it('leaves public surfaces reachable', () => {
    for (const path of ['/', '/legal/terms', '/legal/privacy', '/forgot-password']) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it('redirects signed-in users away from sign-in and sign-up only', () => {
    expect(isAuthOnlyPath('/login')).toBe(true);
    expect(isAuthOnlyPath('/signup')).toBe(true);
    // Password recovery must stay reachable while a recovery session is active.
    expect(isAuthOnlyPath('/reset-password')).toBe(false);
    expect(isAuthOnlyPath('/forgot-password')).toBe(false);
  });

  it('publishes legal links used by auth and the footer', () => {
    expect(LEGAL_LINKS.map((link) => link.href)).toEqual(['/legal/terms', '/legal/privacy']);
  });

  it('keeps the learning loop complete and ordered', () => {
    expect(LEARNING_LOOP.map((step) => step.stage)).toEqual([
      'upload',
      'understand',
      'structure',
      'explore',
      'ask',
      'connect',
      'recall',
      'apply',
      'review',
      'remember',
    ]);
  });
});
