import { generationStatus, handleGeneration } from '@/ai/learning/generation-route';

export const dynamic = 'force-dynamic';

/**
 * Question generation.
 *
 * The client sends a model reference, a semantic id and some preferences. It
 * does not send facts: the server resolves what the structure IS from VEO's
 * own model, so a question VEO presents can never assert something a browser
 * supplied.
 */
export async function POST(request: Request) {
  return handleGeneration(request, 'question');
}

export function GET() {
  return generationStatus();
}
