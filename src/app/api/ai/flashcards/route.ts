import { generationStatus, handleGeneration } from '@/ai/learning/generation-route';

export const dynamic = 'force-dynamic';

/**
 * Flashcard generation.
 *
 * Identical boundary to the questions route, and deliberately a separate
 * endpoint rather than a mode flag: the content type is decided by the URL, so
 * a request here cannot come back as questions.
 */
export async function POST(request: Request) {
  return handleGeneration(request, 'flashcard');
}

export function GET() {
  return generationStatus();
}
