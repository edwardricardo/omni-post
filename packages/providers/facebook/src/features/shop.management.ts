import { FacebookApiClient, FacebookCredentials } from "../apiClient.js";
import { createLogger } from "@observability/logger";
import type {
  FacebookProductInsights,
  FacebookProductResponse,
  FacebookShopConfiguration,
  FacebookShopSection,
} from "./shop.types.js";

const logger = createLogger("provider:facebook:shop-management");

export class FacebookShopManagementApi {
  private apiClient: FacebookApiClient;

  constructor(credentials: FacebookCredentials) {
    this.apiClient = new FacebookApiClient(credentials);
  }

  /**
   * Configure Facebook Shop
   */
  async configureShop(
    configuration: FacebookShopConfiguration
  ): Promise<{ success: boolean; shopUrl?: string }> {
    try {
      // Enable/disable shop
      await this.apiClient.makeApiRequest(`/${this.apiClient.credentials.pageId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shop_enabled: configuration.isEnabled,
        }),
      });

      // Configure shop sections if shop is enabled
      if (configuration.isEnabled && configuration.sections.length > 0) {
        for (const section of configuration.sections) {
          await this.createShopSection(section);
        }
      }

      return {
        success: true,
        shopUrl: `https://www.facebook.com/${this.apiClient.credentials.pageId}/shop`,
      };
    } catch (error) {
      logger.error({ err: error }, "Failed to configure shop");
      return { success: false };
    }
  }

  /**
   * Create a shop section
   */
  private async createShopSection(section: FacebookShopSection): Promise<void> {
    const sectionData = {
      name: section.name,
      product_ids: section.productIds,
      ...(section.description && { description: section.description }),
      ...(section.isActive !== undefined && { is_active: section.isActive }),
      ...(section.order !== undefined && { order: section.order }),
    };

    await this.apiClient.makeApiRequest(`/${this.apiClient.credentials.pageId}/shop_sections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sectionData),
    });
  }

  /**
   * Get product insights
   */
  async getProductInsights(
    productId: string,
    period?: { since?: Date; until?: Date }
  ): Promise<FacebookProductInsights> {
    // Facebook product insights would typically be accessed through the Marketing API
    // This is a simplified version for the basic insights
    const metrics = [
      "product_impressions",
      "product_reach",
      "product_clicks",
      "purchases",
      "purchase_value",
    ];

    try {
      const params = new URLSearchParams({
        metric: metrics.join(","),
        period: "lifetime",
      });

      if (period?.since) {
        params.append("since", Math.floor(period.since.getTime() / 1000).toString());
      }
      if (period?.until) {
        params.append("until", Math.floor(period.until.getTime() / 1000).toString());
      }

      const response = await this.apiClient.makeApiRequest(`/${productId}/insights?${params}`);

      const data = await response.json();

      // Parse insights data
      const insights: Partial<FacebookProductInsights> = {
        productId,
        impressions: 0,
        reach: 0,
        clicks: 0,
        purchases: 0,
        revenue: 0,
        addToCart: 0,
        viewContent: 0,
        initiateCheckout: 0,
        purchaseValue: 0,
        costPerResult: 0,
        returnOnAdSpend: 0,
      };

      // Process insights if available
      if (data.data && Array.isArray(data.data)) {
        for (const metric of data.data) {
          const value = metric.values?.[0]?.value || 0;

          switch (metric.name) {
            case "product_impressions":
              insights.impressions = value;
              break;
            case "product_reach":
              insights.reach = value;
              break;
            case "product_clicks":
              insights.clicks = value;
              break;
            case "purchases":
              insights.purchases = value;
              break;
            case "purchase_value":
              insights.purchaseValue = value;
              insights.revenue = value;
              break;
          }
        }
      }

      return insights as FacebookProductInsights;
    } catch {
      logger.warn("Product insights not available, returning default values");
      return {
        productId,
        impressions: 0,
        reach: 0,
        clicks: 0,
        purchases: 0,
        revenue: 0,
        addToCart: 0,
        viewContent: 0,
        initiateCheckout: 0,
        purchaseValue: 0,
        costPerResult: 0,
        returnOnAdSpend: 0,
        period: {
          since: period?.since?.toISOString() || new Date().toISOString(),
          until: period?.until?.toISOString() || new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Tag products in a post
   */
  async tagProductsInPost(
    postId: string,
    productTags: Array<{
      productId: string;
      x: number; // X coordinate (0-1)
      y: number; // Y coordinate (0-1)
    }>
  ): Promise<boolean> {
    try {
      const tagData = {
        product_tags: productTags.map((tag) => ({
          product_id: tag.productId,
          x: tag.x,
          y: tag.y,
        })),
      };

      await this.apiClient.makeApiRequest(`/${postId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tagData),
      });

      return true;
    } catch (_error) {
      logger.error({ err: _error }, "Failed to tag products in post");
      return false;
    }
  }

  /**
   * Search products in catalog
   */
  async searchProducts(
    catalogId: string,
    query: string,
    filters?: {
      category?: string;
      brand?: string;
      priceMin?: number;
      priceMax?: number;
      availability?: string;
    }
  ): Promise<FacebookProductResponse[]> {
    const params = new URLSearchParams({
      q: query,
      fields: "id,name,description,price,availability,image_url,brand,category",
    });

    if (filters?.category) {
      params.append("category", filters.category);
    }
    if (filters?.brand) {
      params.append("brand", filters.brand);
    }
    if (filters?.availability) {
      params.append("availability", filters.availability);
    }

    const response = await this.apiClient.makeApiRequest(`/${catalogId}/products?${params}`);

    const data = await response.json();

    // Filter by price range if specified
    let products = data.data || [];
    if (filters?.priceMin !== undefined || filters?.priceMax !== undefined) {
      products = products.filter((product: any) => {
        const price = (product.price || 0) / 100; // Convert from cents
        if (filters.priceMin !== undefined && price < filters.priceMin) return false;
        if (filters.priceMax !== undefined && price > filters.priceMax) return false;
        return true;
      });
    }

    return products.map((product: any) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      brand: product.brand,
      category: product.category,
      price: (product.price || 0) / 100,
      availability: product.availability,
      images: [{ id: "main", url: product.image_url }],
      variants: [],
      createdTime: product.created_time || new Date().toISOString(),
      updatedTime: product.updated_time || new Date().toISOString(),
      status: "active" as const,
      visibility: "published" as const,
      condition: "new" as const,
      currency: "USD",
    }));
  }
}
