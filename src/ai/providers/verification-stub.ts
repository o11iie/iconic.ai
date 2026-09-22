import 'server-only';

import { ok, type Result } from '@/lib/result';
import type { VeoError } from '@/lib/errors';
import { DATA_FENCE_CLOSE, DATA_FENCE_OPEN } from '../safety/injection';
import type { LLMClient, LLMCompletion, LLMCompletionOptions, LLMStatus } from '../client';

/**
 * A deterministic stand-in for the language model, for verification only.
 *
 * ## Why this exists
 *
 * Gate 10 must be provable in a browser. Proving it against a live model would
 * prove only that the vendor was up that afternoon — the answer would differ
 * every run, so no assertion could be stronger than "some text appeared", and
 * "some text appeared" is exactly the check that cannot distinguish a working
 * tutor from a broken one.
 *
 * ## What it does NOT do
 *
 * It does not fake the tutor. Every other stage runs for real: request
 * validation, server-side model resolution, context building, prompt assembly,
 * output parsing, schema validation, grounding, id resolution and action
 * dispatch. The single thing replaced is the network call.
 *
 * ## Why it reads the context back
 *
 * Its reply is composed from the context it was actually handed — the real
 * structure name, the real parent, the real relationship targets. So a
 * verification run that asserts the answer names the selected structure is
 * asserting that VEO's context reached the model, not that a fixed string
 * came back. If the context pipeline broke, the reply would stop matching.
 *
 * ## Why it cannot reach a learner
 *
 * Two conditions, both required:
 *
 *   1. `VEO_TUTOR_STUB=1` must be set — an explicit, deliberate opt-in.
 *   2. No real provider may be configured. If `OPENAI_API_KEY` is present the
 *      stub refuses, so it can never shadow a working tutor.
 *
 * Condition 2 is the one that matters. A guard on NODE_ENV would be weaker
 * AND less useful: `next start` runs a production build, so it would block the
 * very verification this exists for, while still permitting the stub in any
 * environment that happened to report development.
 *
 * On top of that it is impossible to mistake: every answer opens with
 * `[VEO VERIFICATION STUB]`, the API response carries `verificationStub: true`,
 * and the workspace shows a banner while it is active.
 */

export const STUB_ENV_VAR = 'VEO_TUTOR_STUB';

/** Every stub answer opens with this, so it is identifiable on sight. */
export const STUB_MARKER = '[VEO VERIFICATION STUB]';

export function stubEnabled(): boolean {
  /*
   * A LITERAL `process.env.VEO_TUTOR_STUB`, not `process.env[STUB_ENV_VAR]`.
   *
   * Next INLINES `process.env.X` at build time and eliminates the dead branch,
   * so this flag is decided when the bundle is built, not when it runs. Two
   * consequences, both deliberate:
   *
   *   - Enabling the stub requires setting the variable for `npm run build`
   *     as well as for the server. Setting it only at runtime does nothing.
   *   - A production bundle built without it cannot be talked into using the
   *     stub afterwards, by any environment change. The branch is not there.
   *
   * A computed key (`process.env[STUB_ENV_VAR]`) survives the transform but
   * then reads a build-time snapshot, which is how a flag ends up silently
   * dead while appearing correct in the source.
   */
  if (process.env.VEO_TUTOR_STUB !== '1') return false;

  // Never shadow a configured provider.
  const key = process.env.OPENAI_API_KEY;
  return typeof key !== 'string' || key.trim().length === 0;
}

interface ContextShape {
  readonly subject?: { readonly semanticId?: string; readonly name?: string; readonly description?: string; readonly function?: string };
  readonly hierarchy?: {
    readonly path?: readonly string[];
    readonly parent?: { readonly semanticId?: string; readonly name?: string };
  };
  readonly relationships?: readonly { readonly targetId?: string; readonly targetName?: string; readonly kind?: string }[];
  readonly related?: readonly { readonly semanticId?: string; readonly name?: string }[];
  readonly availableActions?: readonly string[];
  readonly grounding?: string;
  readonly state?: { readonly layers?: readonly { readonly id?: string; readonly name?: string }[] };
}

export class VerificationStubClient implements LLMClient {
  readonly id = 'veo-verification-stub';

  getStatus(): LLMStatus {
    const enabled = stubEnabled();
    return {
      id: this.id,
      ready: enabled,
      reason: enabled ? null : `${STUB_ENV_VAR} is not enabled in this environment.`,
      model: 'veo-verification-stub',
    };
  }

  async complete(options: LLMCompletionOptions): Promise<Result<LLMCompletion, VeoError>> {
    const context = extractContext(options.messages.map((m) => m.content));
    const level = extractLine(options.messages, 'Learner level: ') ?? 'intermediate';
    const action = extractLine(options.messages, 'Requested action: ') ?? 'EXPLAIN';

    const subject = context?.subject;
    const name = subject?.name ?? 'the selected structure';
    const parent = context?.hierarchy?.parent?.name ?? null;
    const grounding = context?.grounding ?? 'bare';

    /*
     * Depth varies by level, because Gate 10 requires that the same context
     * produces a different explanation per level — and a stub that ignored the
     * level would let that requirement pass untested.
     */
    const depth =
      level === 'foundation'
        ? `In simple terms, ${name} is one part of this model.`
        : level === 'professional'
          ? `${name}: precise structural account, assuming full familiarity with the surrounding assembly.`
          : level === 'advanced'
            ? `${name} is best understood through its structural relationships within the model.`
            : `${name} is a structure in this model, and its place is easiest to see through what contains it.`;

    const lines = [`${STUB_MARKER} ${depth}`];
    if (parent) lines.push(`It sits inside ${parent}.`);
    if (subject?.description) lines.push(subject.description);
    if (grounding === 'bare') {
      lines.push(
        'This model supplies nothing further about it, so there is nothing more VEO can tell you from the model itself.',
      );
    }

    const relationships = context?.relationships ?? [];
    const related = (context?.related ?? []).slice(0, 3);
    const actions = context?.availableActions ?? [];
    const layers = context?.state?.layers ?? [];

    const output = {
      message: lines.join('\n\n'),
      title: `${name} — ${level}`,
      keyPoints: relationships
        .slice(0, 3)
        .map((r) => `${r.kind ?? 'relates to'} ${r.targetName ?? 'another structure'}`),
      relatedStructures: related.map((structure) => ({
        semanticId: structure.semanticId ?? '',
        name: structure.name ?? '',
        reason: 'Named in this model as connected to the selected structure.',
      })),
      suggestedQuestions: [`What does ${name} connect to?`, `Explain ${name} more simply.`],
      spatialActions: buildActions(actions, related, layers),
      // Report what VEO measured. The grounding pass checks this independently,
      // so a stub that over-claimed would be caught rather than believed.
      sourceStatus:
        grounding === 'rich'
          ? 'grounded'
          : grounding === 'structural'
            ? 'partially-grounded'
            : 'insufficient-context',
      confidence: 0.5,
    };

    void action;

    return ok({
      text: JSON.stringify(output),
      model: 'veo-verification-stub',
      inputTokens: null,
      outputTokens: null,
      finishReason: 'stop',
    });
  }
}

/**
 * Propose one structure action and one layer action, when available.
 *
 * Also proposes a deliberately INVALID action so the browser run exercises the
 * rejection path: a tutor that only ever proposes valid actions never proves
 * that an invalid one is refused.
 */
function buildActions(
  available: readonly string[],
  related: readonly { readonly semanticId?: string; readonly name?: string }[],
  layers: readonly { readonly id?: string; readonly name?: string }[],
): { kind: string; semanticId?: string; layerId?: string; label: string }[] {
  const actions: { kind: string; semanticId?: string; layerId?: string; label: string }[] = [];

  const first = related[0];
  if (available.includes('FOCUS_STRUCTURE') && first?.semanticId) {
    actions.push({
      kind: 'FOCUS_STRUCTURE',
      semanticId: first.semanticId,
      label: `Show ${first.name ?? 'it'}`,
    });
  }

  const layer = layers[0];
  if (available.includes('HIDE_LAYER') && layer?.id) {
    actions.push({ kind: 'HIDE_LAYER', layerId: layer.id, label: `Hide ${layer.name ?? 'layer'}` });
  }

  // The rejection probe: a real action kind aimed at a structure this model
  // does not contain. Grounding must drop it before it reaches the browser.
  actions.push({
    kind: 'FOCUS_STRUCTURE',
    semanticId: 'veo.anatomy.invented_structure_for_rejection_test',
    label: 'Invalid target probe',
  });

  return actions;
}

/** Pull the context JSON back out of the fenced block. */
function extractContext(messages: readonly string[]): ContextShape | null {
  for (const message of messages) {
    if (!message.startsWith('VEO CONTEXT for this turn:')) continue;
    const start = message.indexOf(DATA_FENCE_OPEN);
    const end = message.indexOf(DATA_FENCE_CLOSE);
    if (start === -1 || end <= start) continue;
    const json = message.slice(start + DATA_FENCE_OPEN.length, end).trim();
    try {
      return JSON.parse(json) as ContextShape;
    } catch {
      return null;
    }
  }
  return null;
}

function extractLine(
  messages: readonly { readonly content: string }[],
  prefix: string,
): string | null {
  for (const message of messages) {
    for (const line of message.content.split('\n')) {
      if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
    }
  }
  return null;
}
