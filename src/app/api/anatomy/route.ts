import { NextResponse } from 'next/server';
import { env } from '@/config/env';
import { anatomyProviderConfig } from '@/config/anatomy.server';

export const dynamic = 'force-dynamic';

/**
 * Anatomy provider status.
 *
 * Tells the browser whether this deployment can serve anatomy, and if not,
 * why — in the exact words a learner will read. Booleans and prose only: no
 * key, no token, no signing secret, and no provider URL, because a provider
 * endpoint is itself part of a licensed integration.
 */
export function GET() {
  const config = anatomyProviderConfig(env.NEXT_PUBLIC_ANATOMY_PROVIDER);

  return NextResponse.json({
    configured: config.configured,
    reason: config.reason,
    providerId: config.providerId,
    delivery: config.delivery,
    licence: {
      holder: config.licence.holder,
      kind: config.licence.kind,
      application: config.licence.application,
      expiresAt: config.licence.expiresAt,
      expired: config.licence.expired,
    },
  });
}
