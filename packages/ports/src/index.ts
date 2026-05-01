/**
 * @file index.ts
 * @description Barrel exports for the ports package — ProviderAdapter, QueuePort, RepoPort,
 *              StoragePort, CrmAdapter, and PaymentAdapter interfaces.
 * @layer domain
 */
export * from "./CachePort";
export * from "./ProviderAdapter";
export * from "./QueuePort";
export * from "./QueuePortRegistry";
export * from "./DeadLetterQueuePort";
export * from "./RepoPort";
export * from "./StoragePort";
export * from "./CrmAdapter";
export * from "./PaymentAdapter";
