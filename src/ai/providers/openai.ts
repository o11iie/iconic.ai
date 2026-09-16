import 'server-only';

import OpenAI from 'openai';
import { serverEnv } from '@/config/env.server';
import { VeoError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';
import type { LLMClient, LLMCompletion, LLMCompletionOptions, LLMStatus } from '../client';

/**
 * OpenAI adapter.
 *
 * SERVER-ONLY: the `server-only` import makes importing this from a Client
 * Component a build error, so OPENAI_API_KEY cannot leak into a bundle.
 *
 * Reports `ready: false` with a reason when no key is configured rather than
 * throwing at import time, so the app boots without AI configured.
 */
export class OpenAIClient implements LLMClient {
  readonly id = 'openai';

  private client: OpenAI | null = null;

  getStatus(): LLMStatus {
    const env = serverEnv();
    if (!env.OPENAI_API_KEY) {
      return {
        id: this.id,
        ready: false,
        reason: 'OPENAI_API_KEY is not set in this environment.',
        model: null,
      };
    }
    return { id: this.id, ready: true, reason: null, model: env.OPENAI_MODEL };
  }

  private getClient(): OpenAI | null {
    if (this.client) return this.client;
    const env = serverEnv();
    if (!env.OPENAI_API_KEY) return null;
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    return this.client;
  }

  async complete(options: LLMCompletionOptions): Promise<Result<LLMCompletion, VeoError>> {
    const client = this.getClient();
    if (!client) {
      return err(
        new VeoError('OpenAI is not configured.', {
          code: 'provider_not_configured',
          userMessage: 'The AI tutor has not been configured for this environment yet.',
        }),
      );
    }

    const env = serverEnv();

    try {
      const response = await client.chat.completions.create(
        {
          model: env.OPENAI_MODEL,
          messages: options.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          temperature: options.temperature ?? 0.3,
          ...(options.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
          ...(options.json ? { response_format: { type: 'json_object' as const } } : {}),
        },
        options.signal ? { signal: options.signal } : undefined,
      );

      const choice = response.choices[0];
      if (!choice) {
        return err(
          new VeoError('OpenAI returned no choices.', { code: 'provider_unavailable' }),
        );
      }

      return ok({
        text: choice.message.content ?? '',
        model: response.model,
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
        finishReason:
          choice.finish_reason === 'stop'
            ? 'stop'
            : choice.finish_reason === 'length'
              ? 'length'
              : choice.finish_reason === 'content_filter'
                ? 'content_filter'
                : 'other',
      });
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      return err(
        new VeoError('OpenAI request failed.', {
          code: status === 429 ? 'rate_limited' : 'provider_unavailable',
          cause,
        }),
      );
    }
  }
}
