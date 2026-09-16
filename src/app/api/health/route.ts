import { NextResponse } from 'next/server';
import { capabilities } from '@/config/env';
import { serverCapabilities } from '@/config/env.server';

export const dynamic = 'force-dynamic';

/**
 * Health and capability endpoint.
 *
 * Reports which integrations are configured — booleans only, never values.
 * Used by deployment checks and by the verification step of each build gate.
 */
export function GET() {
  const server = serverCapabilities();

  return NextResponse.json({
    status: 'ok',
    service: 'veo',
    timestamp: new Date().toISOString(),
    capabilities: {
      supabase: capabilities.supabase,
      supabaseAdmin: server.supabaseAdmin,
      openai: server.openai,
      stripe: server.stripe,
      stripeWebhooks: server.stripeWebhooks,
      spatialAssets: capabilities.spatialAssets,
      pipelineDiagnostic: capabilities.pipelineDiagnostic,
    },
  });
}
