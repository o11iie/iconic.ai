import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SignOutButton } from '@/components/layout/SignOutButton';
import { capabilities, env } from '@/config/env';
import { serverCapabilities } from '@/config/env.server';
import { getServerUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings.
 *
 * The environment panel reports *whether* each integration is configured —
 * never the values. Rendering a secret, even masked, into HTML would put it in
 * the page source.
 */
export default async function SettingsPage() {
  const user = capabilities.supabase ? await getServerUser() : null;
  const server = serverCapabilities();

  const integrations: { label: string; ready: boolean; note: string }[] = [
    {
      label: 'Supabase (auth, database, storage)',
      ready: capabilities.supabase,
      note: 'Required for accounts, persistence and uploads.',
    },
    {
      label: 'Supabase service role',
      ready: server.supabaseAdmin,
      note: 'Server-only. Used for webhooks and administrative tasks.',
    },
    {
      label: 'OpenAI (tutor, ingestion, generation)',
      ready: server.openai,
      note: 'Server-only. Model calls are proxied through VEO routes.',
    },
    {
      label: 'Stripe (subscriptions)',
      ready: server.stripe,
      note: 'Server-only. Entitlements are derived from verified webhooks.',
    },
    {
      label: 'Licensed spatial assets',
      ready: capabilities.spatialAssets,
      note: 'Anatomy models load from the configured licensed asset host.',
    },
  ];

  return (
    <AppShell
      title="Settings"
      subtitle="Account, integrations and learning preferences."
      actions={user ? <SignOutButton /> : null}
    >
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Account" description="Your VEO identity." />
          <CardBody>
            {user ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-[--color-ink-subtle]">Email</dt>
                <dd className="text-[--color-ink]">{user.email}</dd>
                <dt className="text-[--color-ink-subtle]">User ID</dt>
                <dd className="break-all font-mono text-xs text-[--color-ink-muted]">{user.id}</dd>
              </dl>
            ) : (
              <p className="text-sm text-[--color-ink-muted]">
                Not signed in, or authentication is not configured in this environment.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Environment"
            description="Which integrations are configured. Values are never displayed."
          />
          <CardBody>
            <ul className="flex flex-col divide-y divide-[--color-hairline]">
              {integrations.map((integration) => (
                <li key={integration.label} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-[--color-ink]">{integration.label}</p>
                    <p className="mt-0.5 text-xs text-[--color-ink-subtle]">{integration.note}</p>
                  </div>
                  <Badge tone={integration.ready ? 'success' : 'warning'}>
                    {integration.ready ? 'Configured' : 'Not configured'}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Spatial provider" description="Which provider serves 3D models." />
          <CardBody>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-[--color-ink-subtle]">Active provider</dt>
              <dd className="font-mono text-xs text-[--color-cyan]">
                {env.NEXT_PUBLIC_ANATOMY_PROVIDER}
              </dd>
              <dt className="text-[--color-ink-subtle]">Pipeline diagnostic</dt>
              <dd className="text-[--color-ink-muted]">
                {capabilities.pipelineDiagnostic ? 'Enabled' : 'Disabled'}
              </dd>
            </dl>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
