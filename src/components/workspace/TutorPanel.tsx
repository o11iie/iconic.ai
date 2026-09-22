'use client';

import { useId } from 'react';
import { LEARNING_LEVELS } from '@/types/domain/user';
import type { EducationLevel, TutorAction, ValidatedSpatialAction } from '@/ai/tutor/tutor-types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import type { SemanticId } from '@/lib/semantic-id';
import type { TutorState } from '@/hooks/useTutor';

/**
 * The tutor's answer, inside the workspace.
 *
 * Not a chat window. The spatial model is the experience; this is a panel that
 * explains what is selected in it, so it is laid out as an explanation with
 * affordances — related structures you can go to, actions you can take — rather
 * than as a scrolling transcript. A learner reading a conversation log is a
 * learner not looking at the model.
 *
 * Every state has a designed appearance. There is no arrangement of props that
 * renders an empty box.
 */

const LEVEL_LABELS: Record<EducationLevel, string> = {
  foundation: 'New to this',
  intermediate: 'Building up',
  advanced: 'Confident',
  professional: 'Professional',
};

const SOURCE_BADGE: Record<
  'grounded' | 'partially-grounded' | 'insufficient-context',
  { readonly tone: 'cyan' | 'neutral' | 'warning'; readonly label: string; readonly title: string }
> = {
  grounded: {
    tone: 'cyan',
    label: 'From this model',
    title: "This answer rests on descriptive content the loaded model supplies.",
  },
  'partially-grounded': {
    tone: 'neutral',
    label: 'Partly from this model',
    title:
      'Structural facts come from the model; the explanation around them is general background.',
  },
  'insufficient-context': {
    tone: 'warning',
    label: 'Not in this model',
    title: 'The loaded model carries no substantive information about this structure.',
  },
};

const ACTION_ICONS: Record<string, IconName> = {
  FOCUS_STRUCTURE: 'select',
  SELECT_STRUCTURE: 'select',
  ISOLATE_STRUCTURE: 'isolate',
  SHOW_LAYER: 'layers',
  HIDE_LAYER: 'eyeOff',
  RESET_VIEW: 'reset',
};

export interface TutorPanelProps {
  readonly state: TutorState;
  readonly educationLevel: EducationLevel;
  readonly onEducationLevelChange: (level: EducationLevel) => void;
  readonly onAsk: (action: TutorAction, message?: string) => void;
  readonly onExploreStructure: (semanticId: SemanticId) => void;
  readonly onSpatialAction: (action: ValidatedSpatialAction) => void;
  /** Whether a proposed action would currently succeed. */
  readonly canPerform: (action: ValidatedSpatialAction) => boolean;
  readonly onRetry: () => void;
  readonly className?: string;
}

export function TutorPanel({
  state,
  educationLevel,
  onEducationLevelChange,
  onAsk,
  onExploreStructure,
  onSpatialAction,
  canPerform,
  onRetry,
  className,
}: TutorPanelProps) {
  const levelId = useId();

  return (
    <section
      aria-label="VEO Tutor"
      data-veo-tutor
      data-veo-tutor-status={state.status}
      className={cn('flex min-h-0 flex-col gap-3', className)}
    >
      {/* ---- level control: always available, so depth is the learner's ---- */}
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={levelId} className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Explain for
        </label>
        <select
          id={levelId}
          data-veo-tutor-level
          value={educationLevel}
          onChange={(event) => onEducationLevelChange(event.target.value as EducationLevel)}
          className={cn(
            'h-8 rounded-lg border border-hairline bg-obsidian px-2 text-xs text-ink',
            'transition-colors hover:border-hairline-strong focus:border-accent focus:outline-none',
          )}
        >
          {LEARNING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
      </div>

      {state.status === 'idle' ? <TutorIdle /> : null}
      {state.status === 'loading' ? <TutorLoading /> : null}
      {state.status === 'unavailable' ? (
        <TutorNotice
          icon="alert"
          tone="warning"
          title="Tutor unavailable"
          body={state.error?.message ?? 'The AI tutor has not been configured for this environment yet.'}
        />
      ) : null}
      {state.status === 'error' ? (
        <TutorNotice
          icon="alert"
          tone="danger"
          title="VEO couldn't answer that"
          body={state.error?.message ?? "Something went wrong. Try again."}
          action={
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      ) : null}

      {state.response && state.status !== 'loading' ? (
        <TutorAnswer
          state={state}
          onAsk={onAsk}
          onExploreStructure={onExploreStructure}
          onSpatialAction={onSpatialAction}
          canPerform={canPerform}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

function TutorIdle() {
  return (
    <p className="rounded-lg border border-hairline bg-surface-raised/40 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
      <Icon name="sparkles" size={14} className="mr-1.5 inline-block align-[-2px] text-accent" />
      Ask VEO about the selected structure, or press <strong className="font-medium text-ink">Explain</strong> to start.
    </p>
  );
}

function TutorLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-veo-tutor-loading
      className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised/40 px-3 py-3"
    >
      <p className="flex items-center gap-2 text-xs text-ink-muted">
        <span
          aria-hidden
          className="size-3 shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
        />
        VEO is thinking about this structure…
      </p>
      {/* Skeleton lines, so the panel does not visibly collapse and reflow. */}
      <div className="flex flex-col gap-1.5" aria-hidden>
        <span className="h-2 w-full animate-pulse rounded bg-surface-raised" />
        <span className="h-2 w-[88%] animate-pulse rounded bg-surface-raised" />
        <span className="h-2 w-[64%] animate-pulse rounded bg-surface-raised" />
      </div>
    </div>
  );
}

function TutorNotice({
  icon,
  tone,
  title,
  body,
  action,
}: {
  readonly icon: IconName;
  readonly tone: 'warning' | 'danger';
  readonly title: string;
  readonly body: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      data-veo-tutor-notice={tone}
      className={cn(
        'flex flex-col gap-2 rounded-lg border px-3 py-2.5',
        tone === 'warning'
          ? 'border-warning/25 bg-warning/[0.05]'
          : 'border-danger/25 bg-danger/[0.05]',
      )}
    >
      <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
        <Icon
          name={icon}
          size={14}
          className={cn('mt-0.5 shrink-0', tone === 'warning' ? 'text-warning' : 'text-danger')}
        />
        <span className="min-w-0">
          <strong className="font-medium text-ink">{title}.</strong> {body}
        </span>
      </p>
      {action}
    </div>
  );
}

function TutorAnswer({
  state,
  onAsk,
  onExploreStructure,
  onSpatialAction,
  canPerform,
}: {
  readonly state: TutorState;
  readonly onAsk: (action: TutorAction, message?: string) => void;
  readonly onExploreStructure: (semanticId: SemanticId) => void;
  readonly onSpatialAction: (action: ValidatedSpatialAction) => void;
  readonly canPerform: (action: ValidatedSpatialAction) => boolean;
}) {
  const response = state.response;
  if (!response) return null;

  const badge = SOURCE_BADGE[response.sourceStatus];

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto" data-veo-tutor-answer>
      {/* ---- provenance first: the learner should know before they read ---- */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={badge.tone} title={badge.title} data-veo-source-status={response.sourceStatus}>
          {badge.label}
        </Badge>
        <span className="text-[11px] text-ink-faint" data-veo-tutor-subject={response.selectedStructure.semanticId}>
          {response.selectedStructure.name}
        </span>
      </div>

      {response.title ? (
        <h3 className="text-sm font-semibold leading-snug text-ink">{response.title}</h3>
      ) : null}

      {/* Paragraphs rather than one block: a wall of text is not teaching. */}
      <div className="flex flex-col gap-2" data-veo-tutor-message>
        {response.message
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
          .map((paragraph, index) => (
            <p key={index} className="text-xs leading-relaxed text-ink-muted">
              {paragraph}
            </p>
          ))}
      </div>

      {response.keyPoints.length > 0 ? (
        <ul className="flex flex-col gap-1.5" data-veo-tutor-keypoints>
          {response.keyPoints.map((point, index) => (
            <li key={index} className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
              <Icon name="check" size={13} className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0">{point}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ---- related structures: real ids, straight into the pipeline ---- */}
      {response.relatedStructures.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Related structures
          </h4>
          <ul className="flex flex-col gap-1">
            {response.relatedStructures.map((related) => (
              <li key={related.semanticId}>
                <button
                  type="button"
                  data-veo-related={related.semanticId}
                  onClick={() => onExploreStructure(related.semanticId)}
                  className={cn(
                    'group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left',
                    'transition-colors hover:bg-surface-raised',
                  )}
                >
                  <Icon
                    name="arrowRight"
                    size={13}
                    className="mt-0.5 shrink-0 text-ink-faint group-hover:text-accent"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-ink">{related.name}</span>
                    {related.reason ? (
                      <span className="block text-[11px] leading-snug text-ink-faint">
                        {related.reason}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ---- proposed spatial actions ---- */}
      {response.spatialActions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Show me
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {response.spatialActions.map((action, index) => {
              // An action the scene would now refuse is rendered as refused,
              // not as a live button that silently does nothing.
              const available = canPerform(action);
              return (
                <button
                  key={`${action.kind}-${index}`}
                  type="button"
                  disabled={!available}
                  data-veo-tutor-action={action.kind}
                  data-veo-action-available={available ? 'true' : 'false'}
                  title={available ? action.label : 'Not available on this model right now'}
                  onClick={() => onSpatialAction(action)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                    'transition-colors',
                    available
                      ? 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/16'
                      : 'cursor-not-allowed border-hairline text-ink-faint opacity-60',
                  )}
                >
                  <Icon name={ACTION_ICONS[action.kind] ?? 'select'} size={12} />
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ---- follow-ups keep the conversation on the selected structure ---- */}
      {response.suggestedQuestions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Ask next
          </h4>
          <div className="flex flex-col gap-1">
            {response.suggestedQuestions.map((question, index) => (
              <button
                key={index}
                type="button"
                data-veo-tutor-followup
                onClick={() => onAsk('FOLLOW_UP', question)}
                className={cn(
                  'rounded-lg border border-hairline px-2.5 py-1.5 text-left text-[11px] leading-snug',
                  'text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink',
                )}
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
