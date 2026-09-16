'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { signOutAction } from '@/app/(auth)/actions';

/** Signs out via a server action so the session cookie is cleared server-side. */
export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={() => startTransition(() => void signOutAction())}
    >
      Sign out
    </Button>
  );
}
