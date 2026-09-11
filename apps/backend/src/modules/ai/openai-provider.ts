import OpenAI from "openai";
import { getEnv, isAiConfigured } from "../../env";
import type { AiChatMessage, AiCompletionResult, AiProvider } from "./provider";
import { AiProviderNotConfiguredError } from "./provider";

const MAX_OUTPUT_TOKENS = 500;
const REQUEST_TIMEOUT_MS = 20_000;

export class OpenAiProvider implements AiProvider {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!isAiConfigured()) throw new AiProviderNotConfiguredError("openai");
    if (!this.client) {
      this.client = new OpenAI({ apiKey: getEnv().OPENAI_API_KEY, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
    }
    return this.client;
  }

  async complete(messages: AiChatMessage[]): Promise<AiCompletionResult> {
    const client = this.getClient();
    const response = await client.chat.completions.create({
      model: getEnv().OPENAI_MODEL,
      messages,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.4,
    });

    const content = response.choices[0]?.message?.content ?? "";
    return { content, totalTokens: response.usage?.total_tokens ?? 0 };
  }
}

export const openAiProvider = new OpenAiProvider();
