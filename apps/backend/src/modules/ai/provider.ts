/**
 * Provider-agnostic contract for Ask Slate's runtime AI. The mobile client
 * and the rest of the backend depend only on this interface, never on a
 * specific vendor SDK — swapping OpenAI for Anthropic or anything else
 * later means writing one new class, not touching Ask Slate's routes,
 * rate limiting, or entitlement checks.
 */
export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiCompletionResult {
  content: string;
  /** Token usage for cost accounting; providers that don't report it should estimate conservatively. */
  totalTokens: number;
}

export interface AiProvider {
  complete(messages: AiChatMessage[]): Promise<AiCompletionResult>;
}

export class AiProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`AI provider "${provider}" is not configured. Set the required API key in apps/backend/.env.`);
  }
}
