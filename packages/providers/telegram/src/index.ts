/**
 * @file index.ts
 * @description Telegram Provider - Clean Export.
 *              Exports the class-based TelegramAdapter implementation
 *              and the singleton instance for backward compatibility.
 * @layer infrastructure
 */

// Export class and instance
export { TelegramAdapter, telegramAdapter } from "./TelegramAdapter.js";

// Export API client types
export type { TelegramCredentials } from "./apiClient.js";
export { TelegramApiClient } from "./apiClient.js";

// Default export
import { telegramAdapter as telegramAdapterInstance } from "./TelegramAdapter.js";
export default telegramAdapterInstance;
