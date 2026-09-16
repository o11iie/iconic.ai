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

/** Routes that require an authenticated user. */
export const PROTECTED_PREFIXES = [
  '/dashboard',
  '/learn',
  '/recall',
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

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // Without Supabase configured there is no session to refresh and no way to
  // authenticate, so protected routes stay reachable for local development.
  // They render their own "authentication not configured" state.
  if (!capabilities.supabase) return response;

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
