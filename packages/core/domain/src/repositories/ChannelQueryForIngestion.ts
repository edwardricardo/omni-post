/**
 * @file ChannelQueryForIngestion.ts
 * @description Read-model contract used by ingestion dispatch use cases
 *              (analytics ingestion + inbox sync). Returns a flat shape
 *              for active channels — minimal projection for the dispatch
 *              loop, distinct from the full `ChannelRepository.findById`
 *              that returns the domain aggregate.
 * @layer domain
 */

export interface ChannelQueryForIngestion {
  findActiveChannels(accountId?: string): Promise<
    Array<{
      id: string;
      projectId: string;
      provider: string;
      accountId: string;
    }>
  >;
}
