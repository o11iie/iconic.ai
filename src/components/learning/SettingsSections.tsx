'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Overlay';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Tabs';
import { NotConfiguredState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { ONBOARDING_LEVELS } from '@/data/onboarding';
import { useUIStore } from '@/store/ui-store';

/**
 * Settings sections that need interactivity.
 *
 * Preferences that VEO can genuinely honour right now (reduced motion, labels)
 * are wired to the UI store and take effect immediately. Preferences that
 * require persistence are shown as unavailable rather than saving to nowhere —
 * a toggle that forgets is worse than a toggle that says it cannot remember.
 */

export function LearningPreferences({ canPersist }: { readonly canPersist: boolean }) {
  const reducedMotion = useUIStore((s) => s.reducedMotion);
  const setReducedMotion = useUIStore((s) => s.setReducedMotion);
  const [level, setLevel] = useState<string>('intermediate');

  return (
    <Panel title="Learning preferences" description="How VEO pitches material to you.">
      <div className="flex flex-col gap-5">
        <Field
          label="Learning level"
          hint="Sets the depth of explanations and the difficulty of generated recall material."
        >
          <Segmented
            label="Learning level"
            value={level}
            onChange={setLevel}
            options={ONBOARDING_LEVELS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
        </Field>

        <Field
          label="Reduced motion"
          hint="Damps camera transitions and interface animation. Follows your system setting by default."
        >
          <Toggle
            checked={reducedMotion}
            onChange={setReducedMotion}
            label="Reduce motion"
          />
        </Field>

        {canPersist ? null : (
          <NotConfiguredState
            title="Preferences cannot be saved yet"
            description="Reduced motion applies immediately for this session. Preferences that persist across devices need a connected database."
            requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
          />
        )}
      </div>
    </Panel>
  );
}

export function DataAndPrivacy({ signedIn }: { readonly signedIn: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Panel title="Data and privacy" description="What VEO stores, and how to remove it.">
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-ink-muted">
            Row Level Security policies restrict every row to the account that owns it, and storage
            policies restrict uploaded files to your own folder. These are enforced by the database
            rather than the interface.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={!signedIn}>
              Export my data
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!signedIn}
              onClick={() => setConfirmOpen(true)}
            >
              Delete account
            </Button>
          </div>

          {signedIn ? null : (
            <p className="text-xs text-ink-faint">
              Sign in to export or delete your data.
            </p>
          )}
        </div>
      </Panel>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete your account?"
        description="This removes your profile, uploaded material, notes and learning history. It cannot be undone."
      >
        <div className="flex flex-col gap-4">
          <NotConfiguredState
            title="Account deletion is not enabled in this environment"
            description="Deletion runs as a privileged server operation and requires the Supabase service role key. It is deliberately not wired to a client-side call."
            requirement="SUPABASE_SERVICE_ROLE_KEY"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function NotificationPreferences({ canPersist }: { readonly canPersist: boolean }) {
  const [reviewReminders, setReviewReminders] = useState(true);
  const [productUpdates, setProductUpdates] = useState(false);

  return (
    <Panel title="Notifications" description="When VEO should get in touch.">
      <div className="flex flex-col gap-4">
        <Field label="Review reminders" hint="A nudge when concepts are due to come back.">
          <Toggle checked={reviewReminders} onChange={setReviewReminders} label="Review reminders" />
        </Field>

        <Field label="Product updates" hint="Occasional notes about new subjects and features.">
          <Toggle checked={productUpdates} onChange={setProductUpdates} label="Product updates" />
        </Field>

        {canPersist ? null : (
          <NotConfiguredState
            title="Notification settings cannot be saved yet"
            description="These controls are wired to the interface but there is no connected database to persist them to, and no delivery is scheduled."
            requirement="NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
          />
        )}
      </div>
    </Panel>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 max-w-sm">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">{hint}</p>
      </div>
      <div className="max-w-full shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 rounded-full transition-colors duration-200',
        checked ? 'bg-accent' : 'bg-surface-overlay',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white transition-transform duration-200',
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** Small labelled row used by the integrations list. */
export function IntegrationRow({
  icon,
  label,
  note,
  ready,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly note: string;
  readonly ready: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised text-ink-subtle">
          <Icon name={icon} size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-ink">{label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">{note}</p>
        </div>
      </div>
      <Badge tone={ready ? 'success' : 'warning'}>{ready ? 'Configured' : 'Not configured'}</Badge>
    </li>
  );
}
