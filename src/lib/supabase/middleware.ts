import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { capabilities, env } from '@/config/env';
import type { Database } from '@/types/database';

/**
 * Session refresh + route protection.
 *
 * Runs on every matched request. Two jobs:
 *   1. Refresh the Supabase auth cookie so sessions survive page loads.
 *   2. Redirect unauthenticated users away from protected routes.
 *
 * `getUser()` is used rather than `getSession()` because it validates the JWT
 * against the auth server. A forged cookie therefore cannot pass this gate.
 *
 * This is defence in depth, not the security boundary — Row Level Security in
 * the database is. Middleware only decides what page to render.
 */

/**
 * Routes that require an authenticated user.
 *
 * `/explore` is deliberately absent. The workspace is VEO's product
 * demonstration: a signed-out visitor arriving from the landing page's
 * "Explore VEO" call to action should reach it, and it exposes no personal
 * data — with no session there is nothing to load beyond the public model
 * catalogue, and the viewport reports its real state either way. Saving,
 * notes and recall all live behind the protected routes below.
 */
export const PROTECTED_PREFIXES = [
  '/dashboard',
  '/learn',
  '/recall',
  // Learning analytics are private user data: mastery, review history, study
  // time, streak, recommendations. Nothing here is viewable signed out.
  '/analytics',
  // A learner's plan and remaining allowances are equally private.
  '/plans',
  '/library',
  '/settings',
  '/onboarding',
] as const;

/** Routes a signed-in user should not see. */
export const AUTH_ONLY_PREFIXES = ['/login', '/signup'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthOnlyPath(pathname: string): boolean {
  return AUTH_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Whether this is a production build.
 *
 * Read as a literal so Next inlines it. A production bundle's answer is fixed
 * at build time and cannot be changed by a later environment edit, which is
 * the point: the branch below decides whether protected routes are reachable
 * without authentication, and that decision must not be flippable at runtime.
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * A production deployment with no authentication configured.
 *
 * Refuses rather than rendering. The page a learner would otherwise get is
 * harmless in itself — with no Supabase there is no session and no data, so
 * every protected page renders its own "not configured" state and leaks
 * nothing. But "harmless because the database is missing" is not a security
 * property, it is an accident of the outage. A typo in one environment
 * variable would otherwise turn every protected route into an open one, and
 * the only signal would be pages that look slightly empty.
 *
 * So it fails closed and says exactly which variables are missing — never
 * their values. In development the same misconfiguration still renders, so
 * the shell can be worked on before a database exists.
 */
function unconfigured(): NextResponse {
  return new NextResponse(
    'VEO is not configured for authentication. ' +
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set ' +
      'for this deployment to serve accounts.',
    {
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });

  if (!capabilities.supabase) {
    // See `unconfigured` above. There is no flag that reopens this: an
    // environment variable that re-enabled unauthenticated access to
    // protected routes would be an authentication bypass shipped in
    // production code, which is exactly the shape of mistake this closes.
    if (IS_PRODUCTION && isProtectedPath(request.nextUrl.pathname)) {
      return unconfigured();
    }
    return response;
  }

  return authenticatedSession(request);
}

async function authenticatedSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL as string,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    // Preserve where they were going so sign-in can return them there.
    redirectUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthOnlyPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
