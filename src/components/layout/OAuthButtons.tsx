'use client';

import { signInWithOAuthAction } from '@/app/(auth)/actions';
import { env } from '@/config/env';
import { buttonStyles } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * OAuth provider buttons.
 *
 * Renders nothing at all when no provider is configured, rather than showing
 * disabled buttons for sign-in methods that cannot work. Which providers appear
 * is driven by NEXT_PUBLIC_OAUTH_PROVIDERS, so enabling Google is a
 * configuration change rather than a code change.
 */

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  apple: 'Apple',
  azure: 'Microsoft',
  discord: 'Discord',
};

export function OAuthButtons({ next }: { readonly next?: string | null }) {
  const providers = env.NEXT_PUBLIC_OAUTH_PROVIDERS;
  if (providers.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <form key={provider} action={signInWithOAuthAction}>
            <input type="hidden" name="provider" value={provider} />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <button type="submit" className={cn(buttonStyles('secondary', 'lg'), 'w-full')}>
              Continue with {PROVIDER_LABELS[provider] ?? provider}
            </button>
          </form>
        ))}
      </div>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-hairline" />
        <span className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">or</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>
    </div>
  );
}
