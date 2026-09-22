/**
 * Test-only stand-in for the `server-only` package.
 *
 * The real package throws when imported outside a Server Component. That is
 * the point of it, and it is enforced where it matters: the Next build fails
 * if a Client Component reaches a server module, ESLint forbids the import
 * path from `components`, `store` and `hooks`, and the browser suite scans the
 * shipped bundle for the secrets those modules hold.
 *
 * This stub exists so those same modules can be unit-tested. It deliberately
 * exports nothing — it only has to not throw.
 */
export {};
