/**
 * @file TrackedTermQuery.ts
 * @description Read-model contract for active tracked terms (brand-listening
 *              keywords). Used by the mention-search dispatch use case to decide
 *              what each project listens for. Returns a flat projection — the
 *              minimal shape the dispatch loop needs, distinct from any future
 *              full TrackedTerm aggregate.
 * @layer domain
 */

export type TrackedTermKind = "BRAND" | "MARKET";

export interface TrackedTermForSearch {
  id: string;
  accountId: string;
  projectId: string;
  term: string;
  kind: TrackedTermKind;
}

export interface TrackedTermQuery {
  /**
   * Return all active tracked terms, optionally scoped to a single account.
   */
  findActiveTerms(accountId?: string): Promise<TrackedTermForSearch[]>;
}
