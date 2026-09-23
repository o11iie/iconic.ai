/**
 * A minimal stand-in for Supabase Auth, for browser verification only.
 *
 * ## Why this exists
 *
 * VEO's recall surface is behind authentication, and authentication is
 * Supabase. Without a Supabase project the middleware redirects `/recall` to
 * `/login` and every learning route answers 401 — correctly. That leaves the
 * review UI unverifiable in a real browser, and "the components look right in
 * the source" is not verification.
 *
 * The alternative would have been an environment flag inside VEO that
 * fabricates a learner. That is an authentication bypass living in production
 * code, which is the shape of mistake that ships. So the substitute lives
 * OUT here instead, in the test harness, exactly as the anatomy fixture and
 * the tutor stub do: VEO is pointed at a different auth server and is
 * otherwise completely unmodified.
 *
 * ## What it implements
 *
 * Only what `@supabase/ssr` calls to answer `auth.getUser()`. It is not a
 * database: the learning routes' data access is exercised against real
 * PostgreSQL by `verify-rls.sh` and against real handlers by the route tests.
 *
 * Usage: node scripts/fixture-auth-server.mjs [port]
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.argv[2] ?? 54330);

/** A fixed, obviously-synthetic learner. */
export const FIXTURE_USER = {
  id: '00000000-0000-4000-8000-00000000fee1',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'verification@veo.invalid',
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
  phone: '',
  confirmed_at: '2026-01-01T00:00:00.000Z',
  last_sign_in_at: '2026-01-01T00:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Verification Learner' },
  identities: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  is_anonymous: false,
};

/**
 * The auth cookie a signed-in browser would carry.
 *
 * `@supabase/ssr` stores the session as `base64-` + base64(JSON) under a
 * cookie named after the project host. The name and encoding below were not
 * guessed: they were read off a real `signInWithPassword` against this server,
 * so the client parses this cookie exactly as it would its own.
 */
export function authCookie(supabaseUrl) {
  const host = new URL(supabaseUrl).hostname;
  const ref = host.split('.')[0];

  const session = {
    access_token: 'fixture-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'fixture-refresh-token',
    user: FIXTURE_USER,
  };

  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64')}`,
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
  });
  res.end(payload);
}

/** Build the server. Importing this module must not open a port. */
export function createFixtureAuthServer() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      });
      res.end();
      return;
    }

    // What getUser() calls. Returning the user unconditionally is the whole
    // point: this process exists to make a signed-in browser possible.
    if (url.pathname === '/auth/v1/user') {
      json(res, 200, FIXTURE_USER);
      return;
    }

    if (url.pathname === '/auth/v1/token') {
      json(res, 200, {
        access_token: 'fixture-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'fixture-refresh-token',
        user: FIXTURE_USER,
      });
      return;
    }

    if (url.pathname === '/auth/v1/logout') {
      res.writeHead(204).end();
      return;
    }

    // Anything else — PostgREST, storage — is deliberately NOT implemented.
    // A harness that quietly answered data queries would let a UI test pass
    // against invented rows.
    json(res, 501, {
      message: `fixture-auth-server implements auth only; ${url.pathname} is not available`,
    });
  });
}

// Only when run directly. The verification harness imports `authCookie` from
// this file, and an import that opened a port would collide with the server
// already running.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createFixtureAuthServer();

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`fixture auth server listening on http://127.0.0.1:${PORT}`);
    console.log(`fixture user id: ${FIXTURE_USER.id}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
