/**
 * @file shop.ts
 * @description Barrel re-exports for Facebook Shop — types, catalog API, management API,
 *              and a backward-compatible FacebookShopApi alias.
 * @layer infrastructure
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
