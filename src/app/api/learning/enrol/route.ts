import { isSemanticId, type SemanticId } from '@/lib/semantic-id';
import { enrolSchema, readBody, withLearner } from '@/learning/server/learning-api';

export const dynamic = 'force-dynamic';

/**
 * Put generated content into the learner's schedule.
 *
 * Enrolling is not studying. This creates an item in the `new` phase and
 * nothing else: no review event, no activity row, no streak day. A learner who
 * generates fifty flashcards and closes the tab has studied on zero days, and
 * the dashboard says so.
 *
 * A semantic id that is not one VEO minted is stored as null rather than
 * rejected. The item is still perfectly reviewable — it just cannot offer
 * "View in 3D", because there is no structure to show.
 */
export async function POST(request: Request) {
  const body = await readBody(request, enrolSchema);
  if (!body.ok) return body.response;

  const semanticId: SemanticId | null = isSemanticId(body.data.semanticId)
    ? body.data.semanticId
    : null;

  return withLearner(async ({ store, userId }, now) => {
    const item = await store.enrol({
      userId,
      contentRef: body.data.contentRef,
      contentType: body.data.contentType,
      semanticId,
      modelRef: body.data.modelRef,
      payload: body.data.payload,
      objective: body.data.objective,
      difficulty: body.data.difficulty,
      now,
    });

    return {
      item: {
        itemId: item.id,
        contentId: item.contentId,
        contentType: item.contentType,
        semanticId: item.semanticId,
        phase: item.state.phase,
        dueAt: item.state.dueAt,
      },
    };
  });
}
