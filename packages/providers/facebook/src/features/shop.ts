/**
 * Facebook Shop — barrel re-export
 *
 * Types        → shop.types.ts
 * Catalog/Product/Collection API → shop.catalog.ts  (FacebookShopCatalogApi)
 * Shop management / insights     → shop.management.ts (FacebookShopManagementApi)
 *
 * FacebookShopApi is preserved here as a backward-compatible alias for
 * FacebookShopCatalogApi so existing code that imports this name continues to work.
 */

// Types
export type {
  FacebookProductImage,
  FacebookProductVariant,
  FacebookProductOptions,
  FacebookProductResponse,
  FacebookCatalogOptions,
  FacebookCatalogResponse,
  FacebookShopSection,
  FacebookShopConfiguration,
  FacebookProductInsights,
  FacebookCollectionOptions,
  FacebookCollectionResponse,
} from "./shop.types.js";

// Catalog & product operations
export { FacebookShopCatalogApi } from "./shop.catalog.js";

// Shop management, insights & product tagging
export { FacebookShopManagementApi } from "./shop.management.js";

// Backward-compatible alias — FacebookShopApi was the original monolithic class name
export { FacebookShopCatalogApi as FacebookShopApi } from "./shop.catalog.js";
