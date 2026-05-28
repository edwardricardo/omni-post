/**
 * @file GenerateLocalizedContentUseCase.ts
 * @description Orchestrates locale-native content generation grounded by
 *              the account's per-locale glossary and style guide. The
 *              pipeline embeds the brief, retrieves top-K relevant
 *              glossary terms and style-guide rules via semantic search,
 *              assembles a system prompt that instructs the model to
 *              write natively in the target locale (never translate),
 *              and returns the model's structured output plus the IDs
 *              of the retrieved-and-used terms / rules so the caller
 *              can audit the grounding context.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import type { BrandVoiceRepository } from "@core/domain/repositories/BrandVoiceRepository.js";
import type { SemanticRetrievalPort } from "@core/domain/repositories/SemanticRetrievalPort.js";
import type { AIMessage, StructuredOutputSpec } from "@core/domain/ai/AiServiceContract.js";
import type { LocalizedContentClassification } from "@core/domain/ai/AiStructuredOutputs.js";
import type { EmbeddingService } from "@core/embeddings/EmbeddingService.js";

export interface GenerateLocalizedContentInput {
  accountId: string;
  locale: string;
  brief: string;
  platforms?: string[];
  topK?: number;
}

export interface GenerateLocalizedContentOutput {
  content: string;
  rationale: string | null;
  usedTerms: string[];
  usedRules: string[];
}

const DEFAULT_TOP_K = 5;

export class GenerateLocalizedContentUseCase implements UseCase<
  GenerateLocalizedContentInput,
  GenerateLocalizedContentOutput,
  UseCaseError
> {
  constructor(
    private readonly aiPort: AIServicePort,
    private readonly embeddings: EmbeddingService,
    private readonly retrieval: SemanticRetrievalPort,
    private readonly brandVoiceRepo: BrandVoiceRepository,
    private readonly localizedContentSpec: StructuredOutputSpec<LocalizedContentClassification>,
    private readonly embeddingDimensions: number
  ) {}

  async execute(
    input: GenerateLocalizedContentInput
  ): Promise<Result<GenerateLocalizedContentOutput, UseCaseError>> {
    try {
      const topK = input.topK ?? DEFAULT_TOP_K;

      // When embeddings are unavailable (no provider configured, or the
      // provider is down) the pipeline degrades to brand-voice + locale-
      // native generation without RAG grounding rather than failing the
      // whole request. The empty `usedTerms` / `usedRules` audit fields
      // signal to the caller that no grounding context was applied.
      const embeddingResult = await this.embeddings.embedSingle(
        input.brief,
        { dimensions: this.embeddingDimensions },
        input.accountId
      );
      const queryEmbedding = embeddingResult.ok ? embeddingResult.value : null;

      const [glossaryHits, styleHits, brandVoice] = await Promise.all([
        queryEmbedding
          ? this.retrieval.searchGlossary({
              accountId: input.accountId,
              locale: input.locale,
              queryEmbedding,
              topK,
            })
          : Promise.resolve([]),
        queryEmbedding
          ? this.retrieval.searchStyleGuide({
              accountId: input.accountId,
              locale: input.locale,
              queryEmbedding,
              topK,
            })
          : Promise.resolve([]),
        this.brandVoiceRepo.findByAccountId(input.accountId),
      ]);

      const messages = this.assemblePrompt({
        locale: input.locale,
        brief: input.brief,
        platforms: input.platforms ?? [],
        brandVoice: brandVoice?.systemPrompt ?? null,
        glossaryHits,
        styleHits,
      });

      const aiResult = await this.aiPort.generateStructured(
        messages,
        this.localizedContentSpec,
        { temperature: 0.7 },
        input.accountId
      );
      if (!aiResult.ok) {
        return err(
          new UseCaseError("Localized content generation failed", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
      }

      return ok({
        content: aiResult.value.content,
        rationale: aiResult.value.rationale,
        usedTerms: glossaryHits.map((hit) => hit.id),
        usedRules: styleHits.map((hit) => hit.id),
      });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Unexpected failure in localized content generation",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * Builds the message stack for the LLM call. The system prompt assembles
   * brand voice, glossary entries, and style-guide rules; the user message
   * carries the brief. The locale-native imperative is unambiguous so the
   * model does not translate from another working language.
   */
  private assemblePrompt(args: {
    locale: string;
    brief: string;
    platforms: string[];
    brandVoice: string | null;
    glossaryHits: ReadonlyArray<{
      id: string;
      term: string;
      definition: string;
      usage: string | null;
    }>;
    styleHits: ReadonlyArray<{
      id: string;
      rule: string;
      example: string | null;
      category: string | null;
    }>;
  }): AIMessage[] {
    const segments: string[] = [
      `You are a brand-aware content writer.`,
      `Generate the response natively in locale "${args.locale}" (BCP-47).`,
      `Never translate from another language. The output must read as if written by a native speaker of "${args.locale}".`,
    ];

    if (args.brandVoice) {
      segments.push(`Brand voice:\n${args.brandVoice}`);
    }

    if (args.glossaryHits.length > 0) {
      const glossaryBlock = args.glossaryHits
        .map((hit) => {
          const usage = hit.usage ? ` (e.g. ${hit.usage})` : "";
          return `- ${hit.term}: ${hit.definition}${usage}`;
        })
        .join("\n");
      segments.push(`Glossary (use these terms verbatim when relevant):\n${glossaryBlock}`);
    }

    if (args.styleHits.length > 0) {
      const styleBlock = args.styleHits
        .map((hit) => {
          const example = hit.example ? ` Example: ${hit.example}` : "";
          const cat = hit.category ? `[${hit.category}] ` : "";
          return `- ${cat}${hit.rule}.${example}`;
        })
        .join("\n");
      segments.push(`Style guide:\n${styleBlock}`);
    }

    if (args.platforms.length > 0) {
      segments.push(`Target platforms: ${args.platforms.join(", ")}.`);
    }

    return [
      { role: "system", content: segments.join("\n\n") },
      { role: "user", content: args.brief },
    ];
  }
}
