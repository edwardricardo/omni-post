/**
 * @file AiServiceContract.ts
 * @description Technology-free contract types for the AI service port: the message
 *              shape, generation options, and the schema-validated structured-output
 *              spec. The domain port (`AIServicePort`) speaks only these — never a
 *              provider SDK or schema library — so the domain stays dependency-free.
 * @layer domain
 */

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerationOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
  timeout?: number;
}

/**
 * Provider-agnostic, technology-free spec for a schema-validated structured
 * generation. Infrastructure builds this from a zod schema; the domain port
 * (`AIServicePort`) only sees this shape — never zod — so the domain stays
 * dependency-free. `parse` is the single validation gate: providers route
 * raw model output through it, replacing the fragile `JSON.parse(text)` path.
 */
export interface StructuredOutputSpec<T> {
  /** Schema name surfaced to the provider's native structured-output API. */
  name: string;
  /** Optional human description sent to the model to improve adherence. */
  description?: string;
  /** JSON Schema (draft 2020-12) the provider enforces natively when able. */
  jsonSchema: Record<string, unknown>;
  /**
   * Validates + narrows raw provider output. MUST throw on invalid input
   * (the infra adapter catches and maps to `Result` — never throws across
   * the port boundary).
   */
  parse: (raw: unknown) => T;
}
