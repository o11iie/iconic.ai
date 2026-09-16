import type { Metadata } from 'next';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { SignOutButton } from '@/components/layout/SignOutButton';
import {
  DataAndPrivacy,
  IntegrationRow,
  LearningPreferences,
  NotificationPreferences,
} from '@/components/learning/SettingsSections';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Icon, type IconName } from '@/components/ui/Icon';
import { capabilities, env } from '@/config/env';
import { serverCapabilities } from '@/config/env.server';
import { getServerUser } from '@/lib/supabase/server';
import { LEGAL_LINKS } from '@/config/site';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings.
 *
 * The environment panel reports *whether* each integration is configured,
 * never the values. Rendering a secret — even masked — would put it in the page
 * source.
 */
export default async function SettingsPage() {
  const user = capabilities.supabase ? await getServerUser() : null;
  const server = serverCapabilities();
  const name = (user?.user_metadata?.display_name as string | undefined) ?? null;

  const integrations: { icon: IconName; label: string; ready: boolean; note: string }[] = [
    {
      icon: 'shield',
      label: 'Supabase — auth, database, storage',
      ready: capabilities.supabase,
      note: 'Required for accounts, persistence and uploads.',
    },
    {
      icon: 'lock',
      label: 'Supabase service role',
      ready: server.supabaseAdmin,
      note: 'Server-only. Used for webhooks and administrative tasks.',
    },
    {
      icon: 'sparkles',
      label: 'OpenAI — tutor, ingestion, generation',
      ready: server.openai,
      note: 'Server-only. Model calls are proxied through VEO routes.',
    },
    {
      icon: 'card',
      label: 'Stripe — subscriptions',
      ready: server.stripe,
      note: 'Server-only. Entitlements are derived from verified webhooks.',
    },
    {
      icon: 'explore',
      label: 'Licensed spatial assets',
      ready: capabilities.spatialAssets,
      note: 'Anatomy models load from the configured licensed asset host.',
    },
    {
      icon: 'user',
      label: 'OAuth providers',
      ready: capabilities.oauth,
      note: capabilities.oauth
        ? `Enabled: ${env.NEXT_PUBLIC_OAUTH_PROVIDERS.join(', ')}.`
        : 'Password sign-in only. Add providers to enable social sign-in.',
    },
  ];

  return (
    <AppShell
      title="Settings"
      subtitle="Account, preferences and the integrations this deployment has configured."
      actions={user ? <SignOutButton /> : null}
    >
      <div className="flex flex-col gap-4">
        {/* ---- profile ---- */}
        <Panel title="Profile" description="Your VEO identity.">
          {user ? (
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name={name} email={user.email ?? null} size={48} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{name ?? user.email}</p>
                <p className="mt-0.5 break-all text-xs text-ink-subtle">{user.email}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-ink-faint">
                  {user.id}
                </p>
              </div>
              <ButtonLink href="/onboarding" variant="secondary" size="sm">
                Update preferences
              </ButtonLink>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-muted">
                {capabilities.supabase
                  ? 'You are not signed in.'
                  : 'Authentication is not configured in this environment.'}
              </p>
              <ButtonLink href="/login" size="sm">
                Sign in
              </ButtonLink>
            </div>
          )}
        </Panel>

        <LearningPreferences canPersist={capabilities.supabase} />

        {/* ---- appearance ---- */}
        <Panel title="Appearance" description="How VEO looks.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 max-w-sm">
              <p className="text-sm font-medium text-ink">Theme</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
                VEO uses a single deep obsidian theme. The interface is built so the 3D viewport
                stays the brightest thing on screen, which a light theme would undo.
              </p>
            </div>
            <Badge tone="neutral">Obsidian</Badge>
          </div>
        </Panel>

        <NotificationPreferences canPersist={capabilities.supabase} />

        {/* ---- subscription ---- */}
        <Panel title="Subscription" description="Your plan and what it unlocks.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 max-w-sm">
              <p className="text-sm font-medium text-ink">Free</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
                {server.stripe
                  ? 'Entitlements are derived server-side from Stripe and re-checked on every gated action.'
                  : 'Billing is not configured in this environment, so every account is on the free tier.'}
              </p>
            </div>
            <Badge tone={server.stripe ? 'success' : 'warning'}>
              {server.stripe ? 'Billing configured' : 'Billing not configured'}
            </Badge>
          </div>
        </Panel>

        {/* ---- environment ---- */}
        <Panel
          title="Environment"
          description="Which integrations are configured. Values are never displayed."
        >
          <ul className="flex flex-col divide-y divide-hairline">
            {integrations.map((integration) => (
              <IntegrationRow key={integration.label} {...integration} />
            ))}
          </ul>

          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-hairline pt-4 text-sm">
            <dt className="text-ink-subtle">Spatial provider</dt>
            <dd className="font-mono text-xs text-cyan">
              {env.NEXT_PUBLIC_ANATOMY_PROVIDER}
            </dd>
            <dt className="text-ink-subtle">Pipeline diagnostic</dt>
            <dd className="text-ink-muted">
              {capabilities.pipelineDiagnostic ? 'Enabled' : 'Disabled'}
            </dd>
          </dl>
        </Panel>

        <DataAndPrivacy signedIn={Boolean(user)} />

        {/* ---- legal + sign out ---- */}
        <Panel title="About" description="Legal and account actions.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Legal" className="flex items-center gap-4">
              {LEGAL_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-1.5 rounded text-sm text-ink-muted hover:text-ink"
                >
                  <Icon name="link" size={14} />
                  {link.label}
                </Link>
              ))}
            </nav>
            {user ? <SignOutButton /> : null}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
