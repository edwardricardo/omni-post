/**
 * @file SemanticRetrievalPort.ts
 * @description Read-side port for semantic retrieval over the per-locale
 *              glossary and style-guide collections. Implementations rank
 *              candidates by cosine similarity against the supplied query
 *              embedding and return the top-K hits with the original
 *              textual fields plus the similarity score (lower = more
 *              similar in cosine distance, range 0..2).
 * @layer domain
 */

export interface SemanticRetrievalQuery {
  accountId: string;
  locale: string;
  queryEmbedding: number[];
  topK: number;
}

export interface GlossaryHit {
  id: string;
  term: string;
  definition: string;
  usage: string | null;
  /** Cosine distance (0 = identical, 2 = opposite). Lower is better. */
  distance: number;
}

export interface StyleGuideHit {
  id: string;
  rule: string;
  example: string | null;
  category: string | null;
  /** Cosine distance (0 = identical, 2 = opposite). Lower is better. */
  distance: number;
}

export interface SemanticRetrievalPort {
  /**
   * Rank glossary entries for `query.accountId` + `query.locale` by cosine
   * similarity against `queryEmbedding` and return the top `topK` hits with
   * their distance score.
   */
  searchGlossary(query: SemanticRetrievalQuery): Promise<GlossaryHit[]>;
  /**
   * Rank style-guide rules for `query.accountId` + `query.locale` by cosine
   * similarity against `queryEmbedding` and return the top `topK` hits with
   * their distance score.
   */
  searchStyleGuide(query: SemanticRetrievalQuery): Promise<StyleGuideHit[]>;
}
