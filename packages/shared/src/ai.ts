/**
 * Ask Slate request/response contract between mobile and backend.
 * The mobile client NEVER talks to an AI provider directly — see
 * apps/backend/src/modules/ai/provider.ts for the server-side abstraction.
 */
export interface AskSlateContext {
  titleId?: string;
  conversationId?: string;
  spoilerSensitivity: "hide_all" | "hide_recent" | "show_all";
}

export interface AskSlateRequest {
  message: string;
  context: AskSlateContext;
}

export interface AskSlateResponse {
  conversationId: string;
  message: string;
  /** True if the model indicated it lacked grounded data and declined to speculate. */
  declinedToSpeculate: boolean;
  usage: {
    requestsRemainingToday: number | "unlimited";
  };
}
