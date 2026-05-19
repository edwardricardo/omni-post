/**
 * @file aiWireServer.ts
 * @description HTTP-faithful MSW harness for AI provider adapter tests. Each
 *              provider SDK (OpenAI, Anthropic, Google GenAI) and the raw
 *              Perplexity fetch client all issue requests through global
 *              `fetch`, so a single `msw/node` server intercepts the real wire.
 *              Tests assert the on-the-wire request shape (structured-output
 *              directives) and feed back provider-faithful response envelopes,
 *              instead of monkey-patching SDK internals.
 * @layer infrastructure
 */
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll } from "vitest";

/** Public endpoints each provider client targets. */
export const AI_ENDPOINTS = {
  openai: "https://api.openai.com/v1/chat/completions",
  perplexity: "https://api.perplexity.ai/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  // The Google GenAI SDK builds a model-and-action path (`models/<m>:generateContent`)
  // plus a key query. A RegExp matches any of those shapes; tests assert on the
  // decoded request body rather than the exact URL.
  gemini: /^https:\/\/generativelanguage\.googleapis\.com\//,
} as const;

/** Shared server. Handlers are registered per-test via `aiWireServer.use(...)`. */
export const aiWireServer = setupServer();

/**
 * @function useAiWireServer
 * @description Registers the MSW server lifecycle for the calling suite:
 *   starts before all tests (erroring on any unhandled request so a missed
 *   interception is a hard failure, never a real network call), resets
 *   handlers between tests, and closes after all tests.
 */
export function useAiWireServer(): void {
  beforeAll(() => aiWireServer.listen({ onUnhandledRequest: "error" }));
  afterEach(() => aiWireServer.resetHandlers());
  afterAll(() => aiWireServer.close());
}

/**
 * @function openAiChatResponse
 * @description Wraps a structured payload in an OpenAI/Perplexity
 *   chat-completion envelope (both speak the same `choices[].message.content`
 *   shape). The provider JSON-parses `content` then schema-validates it.
 * @param payload - The structured object the model "returned".
 * @returns An MSW JSON response.
 */
export function openAiChatResponse(payload: unknown): HttpResponse {
  return HttpResponse.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(payload) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

/**
 * @function anthropicToolResponse
 * @description Wraps a structured value in an Anthropic forced-tool-use
 *   message envelope. The provider locates the `tool_use` block and
 *   schema-validates its `input`.
 * @param toolName - The tool name the adapter forced (the spec name).
 * @param input - The structured value the model "returned" as tool input.
 * @returns An MSW JSON response.
 */
export function anthropicToolResponse(toolName: string, input: unknown): HttpResponse {
  return HttpResponse.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "tool_use", id: "toolu_test", name: toolName, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}

/**
 * @function geminiResponse
 * @description Wraps a structured payload in a Google GenAI
 *   `generateContent` envelope. The SDK's `.text` accessor concatenates the
 *   candidate text parts; the provider JSON-parses and schema-validates it.
 * @param payload - The structured object the model "returned".
 * @returns An MSW JSON response.
 */
export function geminiResponse(payload: unknown): HttpResponse {
  return HttpResponse.json({
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(payload) }], role: "model" },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    modelVersion: "test-model",
  });
}

export { http, HttpResponse };
