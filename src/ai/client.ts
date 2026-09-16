import type { Result } from '@/lib/result';
import type { VeoError } from '@/lib/errors';

/**
 * LLM abstraction.
 *
 * VEO is not wired to one model vendor. Every AI feature — tutoring, ingestion,
 * question generation, flashcard generation — talks to this interface, and a
 * concrete adapter (see `providers/openai.ts`) supplies the vendor.
 *
 * All implementations are SERVER-ONLY. Keys never reach the browser; the UI
 * calls VEO server routes, which call this.
 */

export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LLMCompletionOptions {
  readonly messages: readonly LLMMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
  /** Request a JSON object response, for structured generation. */
  readonly json?: boolean;
}

export interface LLMCompletion {
  readonly text: string;
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly finishReason: 'stop' | 'length' | 'content_filter' | 'other';
}

export interface LLMStatus {
  readonly id: string;
  readonly ready: boolean;
  readonly reason: string | null;
  readonly model: string | null;
}

export interface LLMClient {
  readonly id: string;
  getStatus(): LLMStatus;
  complete(options: LLMCompletionOptions): Promise<Result<LLMCompletion, VeoError>>;
}

/** Registered LLM adapters, by id. */
const clients = new Map<string, () => LLMClient>();

export function registerLLMClient(id: string, factory: () => LLMClient): void {
  clients.set(id, factory);
}

export function getLLMClient(id: string): LLMClient | null {
  const factory = clients.get(id);
  return factory ? factory() : null;
}

export function listLLMClients(): readonly string[] {
  return [...clients.keys()];
}
