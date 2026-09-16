import type { ReactNode } from 'react';

/**
 * Route group for the authenticated application. Middleware has already
 * enforced the session for these paths; each page renders its own shell so it
 * can set its own title and header actions.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
