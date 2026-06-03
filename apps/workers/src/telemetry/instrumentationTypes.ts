/**
 * @file instrumentationTypes.ts
 * @description Shared instrumentation/telemetry type contracts for the publish
 *              handler. Lives in a leaf module imported by both
 *              publishHandlerTypes.ts and telemetry/initialization.ts so neither
 *              depends on the other.
 * @layer infrastructure
 */

/**
 * Content publication metric payload tracked on a successful/failed publish.
 */
export type ContentMetrics = {
  postId: string;
  provider: string;
  contentType: string;
  publishTime: Date;
  success: boolean;
  error?: string;
};

/**
 * Instrumentation interface for OpenTelemetry spans.
 */
export interface PublishInstrumentation {
  instrumentPublishing(
    name: string,
    provider: string,
    channelId: string,
    type: string,
    fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>,
    metadata?: Record<string, string>
  ): Promise<unknown>;

  instrumentProviderAPI(
    provider: string,
    operation: string,
    method: string,
    fn: (span: { setAttributes: (attrs: Record<string, string>) => void }) => Promise<unknown>
  ): Promise<unknown>;
}

/**
 * Database instrumentation interface.
 */
export interface DatabaseInstrumentation {
  instrumentQuery(operation: string, table: string, fn: () => Promise<unknown>): Promise<unknown>;
}

/**
 * Business KPI tracker interface.
 */
export interface BusinessKPITracker {
  trackContentPublication(metrics: ContentMetrics): void;
}
