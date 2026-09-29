'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Panel } from '@/components/ui/Panel';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Overlay';
import { Badge } from '@/components/ui/Badge';
import { DELETION_CONFIRMATION } from '@/account/lifecycle';
import { LEARNING_LEVELS } from '@/types/domain/user';

/**
 * The learner's own account.
 *
 * Every piece of state on this screen comes from `/api/account`, which
 * resolves identity from the session. Nothing is read from local state and
 * presented as fact — a settings page that showed a display name the server
 * had rejected would be the same lie as a plans page showing a tier nobody
 * paid for.
 */

interface Profile {
  readonly displayName: string | null;
  readonly level: string;
  readonly timeZone: string;
  readonly locale: string;
  readonly interests: readonly string[];
  readonly onboardedAt: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly profile: Profile };

const LEVEL_LABELS: Record<string, string> = {
  foundation: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  professional: 'Professional',
};

export function AccountSettings() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      const body = await response.json();

      if (response.status === 401) return setPhase({ kind: 'signed_out' });
      if (!response.ok || !body.ok) return setPhase({ kind: 'unavailable' });

      setPhase({ kind: 'ready', profile: body.profile as Profile });
    } catch {
      setPhase({ kind: 'unavailable' });
    }
  }, []);

  useEffect(() => {
    // Wrapped rather than called directly: the state update happens once the
    // fetch resolves, not in the effect body, which is what keeps this a
    // subscription to an external system rather than a cascading render.
    void (async () => {
      await load();
    })();
  }, [load]);

  if (phase.kind === 'loading') {
    return (
      <Panel title="Your account" description="Loading…">
        <p className="text-sm text-ink-muted">Reading your account…</p>
      </Panel>
    );
  }

  if (phase.kind === 'signed_out') {
    return (
      <Panel title="Your account" description="Who you are on VEO.">
        <p className="text-sm text-ink-muted">Sign in to see your account.</p>
      </Panel>
    );
  }

  if (phase.kind === 'unavailable') {
    return (
      <Panel title="Your account" description="Who you are on VEO.">
        <p className="text-sm text-ink-muted">
          VEO could not read your account just now. Nothing has been changed.
        </p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-veo-account>
      <ProfileForm profile={phase.profile} onSaved={load} />
      <DangerZone />
    </div>
  );
}

// ---------------------------------------------------------------------------

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly message: string };

function ProfileForm({
  profile,
  onSaved,
}: {
  readonly profile: Profile;
  readonly onSaved: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [level, setLevel] = useState(profile.level);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  const dirty = displayName !== (profile.displayName ?? '') || level !== profile.level;

  async function save() {
    setState({ kind: 'saving' });
    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim(), level }),
      });
      const body = await response.json();

      if (!response.ok || !body.ok) {
        setState({
          kind: 'failed',
          message: body?.error?.message ?? 'VEO could not save that.',
        });
        return;
      }

      // Re-read rather than trusting what was sent: the saved state is
      // whatever the server now holds, and saying "saved" without checking is
      // how a UI ends up disagreeing with the database.
      await onSaved();
      setState({ kind: 'saved' });
    } catch {
      setState({ kind: 'failed', message: 'VEO could not reach the server.' });
    }
  }

  return (
    <Panel title="Your account" description="Who you are on VEO.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-muted" data-veo-account-email>
            {profile.email ?? 'No email on this account'}
          </span>
          {profile.email ? (
            <Badge tone={profile.emailVerified ? 'cyan' : 'warning'} data-veo-email-state>
              {profile.emailVerified ? 'Verified' : 'Not verified'}
            </Badge>
          ) : null}
        </div>

        {profile.email && !profile.emailVerified ? (
          <p className="text-xs leading-relaxed text-ink-faint">
            This address has not been confirmed. VEO reports what Supabase recorded rather
            than assuming — a deployment with confirmation switched off has verified
            nothing, and saying otherwise would be a fake success state.
          </p>
        ) : null}

        <Input
          label="Display name"
          value={displayName}
          maxLength={80}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setState({ kind: 'idle' });
          }}
          data-veo-display-name
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink">Learning level</span>
          <select
            className="rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink"
            value={level}
            onChange={(event) => {
              setLevel(event.target.value);
              setState({ kind: 'idle' });
            }}
            data-veo-level
          >
            {LEARNING_LEVELS.map((value) => (
              <option key={value} value={value}>
                {LEVEL_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || state.kind === 'saving' || displayName.trim().length === 0}
            data-veo-save-profile
          >
            {state.kind === 'saving' ? 'Saving…' : 'Save changes'}
          </Button>

          {state.kind === 'saved' ? (
            <span className="text-xs text-cyan" role="status" data-veo-save-result>
              Saved.
            </span>
          ) : null}
          {state.kind === 'failed' ? (
            <span className="text-xs text-warning" role="alert" data-veo-save-result>
              {state.message}
            </span>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

type DeleteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'deleting' }
  | { readonly kind: 'failed'; readonly message: string };

function DangerZone() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<DeleteState>({ kind: 'idle' });

  const confirmed = typed === DELETION_CONFIRMATION;

  async function remove() {
    setState({ kind: 'deleting' });
    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: typed }),
      });
      const body = await response.json();

      if (!response.ok || !body.ok) {
        setState({
          kind: 'failed',
          message: body?.error?.message ?? 'VEO could not delete your account.',
        });
        return;
      }

      /*
       * A full document load, deliberately, and the one case where the usual
       * advice does not apply.
       *
       * `router.push` keeps the React tree, the client-side router cache and
       * any RSC payload already fetched for the signed-in app. The account
       * those describe no longer exists, so continuing to render from them
       * would show a deleted learner their own data until something happened
       * to evict it. Replacing the document throws all of it away.
       */
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/';
    } catch {
      setState({ kind: 'failed', message: 'VEO could not reach the server.' });
    }
  }

  return (
    <>
      <Panel title="Delete your account" description="Permanent, and immediate.">
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-ink-muted">
            This removes your profile, your uploaded material, your notes and your entire
            learning history. Everything is deleted by the database itself, through the
            same ownership rules that keep it private — there is no copy left behind for
            VEO to recover.
          </p>
          <p className="text-xs leading-relaxed text-ink-faint">
            If you are on a paid plan, cancel it first. VEO will not delete the only
            record of who is being billed while a charge is still running.
          </p>
          <div>
            <Button variant="danger" size="sm" onClick={() => setOpen(true)} data-veo-delete-open>
              Delete account
            </Button>
          </div>
        </div>
      </Panel>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setTyped('');
          setState({ kind: 'idle' });
        }}
        title="Delete your account?"
        description="This cannot be undone."
      >
        <div className="flex flex-col gap-4" data-veo-delete-modal>
          <p className="text-sm leading-relaxed text-ink-muted">
            Type <span className="font-medium text-ink">{DELETION_CONFIRMATION}</span> to
            confirm.
          </p>

          <Input
            label={`Type ${DELETION_CONFIRMATION}`}
            hideLabel
            value={typed}
            autoComplete="off"
            onChange={(event) => {
              setTyped(event.target.value);
              setState({ kind: 'idle' });
            }}
            data-veo-delete-confirm
          />

          {state.kind === 'failed' ? (
            <p
              className="flex items-start gap-2 text-xs leading-relaxed text-warning"
              role="alert"
              data-veo-delete-error
            >
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>{state.message}</span>
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(false);
                setTyped('');
                setState({ kind: 'idle' });
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              /*
               * Disabled until the phrase matches, so the control is never a
               * dead button. The server checks the same phrase regardless —
               * this only spares somebody a pointless round trip.
               */
              disabled={!confirmed || state.kind === 'deleting'}
              onClick={remove}
              data-veo-delete-confirm-button
            >
              {state.kind === 'deleting' ? 'Deleting…' : 'Delete my account'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
