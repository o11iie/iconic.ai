import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Next.js 16 "proxy" convention (formerly `middleware`).
 *
 * Refreshes the Supabase session cookie and gates protected routes before a
 * page renders. See `src/lib/supabase/middleware.ts` for the logic and why it
 * is defence in depth rather than the security boundary.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Spatial assets under
     * /models are excluded too: they are large, cached, and never need a
     * session check to serve.
     */
    '/((?!_next/static|_next/image|favicon.ico|models/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|gltf|bin|ktx2)$).*)',
  ],
};
