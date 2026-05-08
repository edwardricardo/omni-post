/**
 * @file index.ts
 * @description Telegram provider package barrel export. Composition root constructs
 *   the adapter via `createTelegramAdapter({ logger })`.
 * @layer infrastructure
 */

export {
  TelegramAdapter,
  createTelegramAdapter,
  type TelegramAdapterDeps,
  type TelegramApiClientFactory,
} from "./TelegramAdapter.js";

export type {
  TelegramCredentials,
  TelegramMessageResponse,
  TelegramInlineKeyboard,
  TelegramPollConfig,
  TelegramAudioConfig,
} from "./apiClient.js";
export { TelegramApiClient } from "./apiClient.js";
