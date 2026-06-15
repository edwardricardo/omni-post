/**
 * @file index.ts
 * @description Barrel exports for the shared UI package — components, business components,
 *              hooks, and utility functions.
 * @layer infrastructure
 */
// UI Components
export * from "./components/alert.js";
export * from "./components/alert-dialog.js";
export * from "./components/confirm-dialog.js";
export * from "./components/input-dialog.js";
export * from "./components/avatar.js";
export * from "./components/badge.js";
export * from "./components/button.js";
export * from "./components/card.js";
export * from "./components/checkbox.js";
export * from "./components/dialog.js";
export * from "./components/dropdown-menu.js";
export * from "./components/input.js";
export * from "./components/label.js";
export * from "./components/popover.js";
export * from "./components/progress.js";
export * from "./components/scroll-area.js";
export * from "./components/select.js";
export * from "./components/separator.js";
export * from "./components/slider.js";
export * from "./components/submit-button.js";
export * from "./components/switch.js";
export * from "./components/table.js";
export * from "./components/tabs.js";
export * from "./components/textarea.js";
export * from "./components/toast.js";
export * from "./components/toaster.js";
export * from "./components/tooltip.js";
export * from "./components/use-toast.js";
export {
  VirtualScrollList,
  memoizeVirtualItem,
  useVirtualScroll,
} from "./components/VirtualScrollList.js";

// Business Components
export * from "./components/business/ChannelMultiSelect.js";
export * from "./components/business/ContentVersioning.js";
export * from "./components/business/ContentEditorCore.js";
export { EmojiPickerButton } from "./components/business/EmojiPickerButton.js";
// TipTapContentEditor NOT re-exported: pulls @tiptap/* into every consumer.
// Import via subpath "@packages/ui/components/business/TipTapContentEditor" + next/dynamic.
export * from "./components/business/ValidationContentEditor.js";

// Hooks
export { usePublishingEngine } from "./hooks/usePublishingEngine.js";
export type {
  PublishResult,
  ValidationError,
  PublishingStats,
  PublishingEngineOptions,
  PublishingEngineState,
} from "./hooks/usePublishingEngine.js";
export { useProviderConstraints } from "./hooks/useProviderConstraints.js";

// Utils
export { cn } from "./lib/utils.js";
