/**
 * @file shop.catalog.ts
 * @description Facebook Shop catalog service — creates and manages product catalogs, products,
 *              product variants, and collections via the Graph API.
 * @layer infrastructure
 */
import { FacebookApiClient, FacebookCredentials } from "../apiClient.js";
import { AppError } from "@shared/types";
import { createLogger } from "@observability/logger";
import type {
  FacebookCatalogOptions,
  FacebookCatalogResponse,
  FacebookCollectionOptions,
  FacebookCollectionResponse,
  FacebookProductImage,
  FacebookProductOptions,
  FacebookProductResponse,
  FacebookProductVariant,
} from "./shop.types.js";

const logger = createLogger("provider:facebook:shop-catalog");

export class FacebookShopCatalogApi {
  private apiClient: FacebookApiClient;

  constructor(credentials: FacebookCredentials) {
    this.apiClient = new FacebookApiClient(credentials);
  }

  /**
   * Create a product catalog
   */
  async createCatalog(options: FacebookCatalogOptions): Promise<FacebookCatalogResponse> {
    const catalogData = {
      name: options.name,
      vertical: options.verticalType,
      ...(options.description && { description: options.description }),
      ...(options.defaultImageUrl && { default_image_url: options.defaultImageUrl }),
      ...(options.brand && { brand: options.brand }),
      ...(options.contentType && { content_type: options.contentType }),
    };

    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/owned_product_catalogs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(catalogData),
      }
    );

    const result = await response.json();
    return this.getCatalogDetails(result.id);
  }

  /**
   * Get catalog details
   */
  async getCatalogDetails(catalogId: string): Promise<FacebookCatalogResponse> {
    const response = await this.apiClient.makeApiRequest(
      `/${catalogId}?fields=id,name,vertical,description,product_count,brand,created_time,updated_time,default_image_url,content_type`
    );

    const data = await response.json();

    return {
      id: data.id,
      name: data.name,
      verticalType: data.vertical,
      description: data.description,
      productCount: data.product_count || 0,
      brand: data.brand,
      createdTime: data.created_time,
      updatedTime: data.updated_time,
      defaultImageUrl: data.default_image_url,
      contentType: data.content_type || "product",
    };
  }

  /**
   * Create a product in the catalog
   */
  async createProduct(
    catalogId: string,
    options: FacebookProductOptions
  ): Promise<FacebookProductResponse> {
    // Upload product images
    const uploadedImages = await this.uploadProductImages(options.images);

    // Prepare the main product variant (required)
    const mainVariant = options.variants[0];
    if (!mainVariant) {
      throw AppError.validationFailed("At least one product variant is required");
    }

    const productData: Record<string, unknown> = {
      name: options.name,
      description: options.description,
      condition: options.condition,
      currency: options.currency,
      price: mainVariant.price * 100, // Facebook expects price in cents
      availability: mainVariant.availability,
      image_url: uploadedImages[0]?.url || options.images[0]?.url,
      brand: options.brand,
      category: options.category,
      ...(options.url && { url: options.url }),
      ...(mainVariant.salePrice && { sale_price: mainVariant.salePrice * 100 }),
      ...(mainVariant.sku && { retailer_id: mainVariant.sku }),
      ...(mainVariant.gtin && { gtin: mainVariant.gtin }),
      ...(options.googleProductCategory && {
        google_product_category: options.googleProductCategory,
      }),
      ...(options.productType && { product_type: options.productType }),
    };

    // Add additional images
    if (uploadedImages.length > 1) {
      productData.additional_image_urls = uploadedImages.slice(1).map((img) => img.url);
    }

    // Add optional attributes
    if (options.customLabels) {
      Object.entries(options.customLabels).forEach(([key, value]) => {
        if (value) {
          productData[key] = value;
        }
      });
    }

    // Add physical attributes
    if (options.ageGroup) productData.age_group = options.ageGroup;
    if (options.gender) productData.gender = options.gender;
    if (options.material) productData.material = options.material;
    if (options.pattern) productData.pattern = options.pattern;
    if (options.size) productData.size = options.size;
    if (options.sizeType) productData.size_type = options.sizeType;
    if (options.sizeSystem) productData.size_system = options.sizeSystem;
    if (options.origin) productData.origin_country = options.origin;

    // Add weight and dimensions
    if (options.weight) {
      productData.shipping_weight_value = options.weight.value;
      productData.shipping_weight_unit = options.weight.unit;
    }

    if (options.shippingWeight) {
      productData.shipping_weight_value = options.shippingWeight.value;
      productData.shipping_weight_unit = options.shippingWeight.unit;
    }

    // Create the product
    const response = await this.apiClient.makeApiRequest(`/${catalogId}/products`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(productData),
    });

    const result = await response.json();

    // Create additional variants if provided
    if (options.variants.length > 1) {
      await this.createProductVariants(result.id, options.variants.slice(1));
    }

    return this.getProductDetails(result.id);
  }

  /**
   * Upload product images
   */
  private async uploadProductImages(
    images: FacebookProductImage[]
  ): Promise<Array<{ id: string; url: string }>> {
    const uploadedImages = [];

    for (const image of images) {
      try {
        const uploadResult = await this.apiClient.uploadUnpublishedMedia(image.url, "photo");
        uploadedImages.push({
          id: uploadResult.id,
          url: image.url,
        });
      } catch (error) {
        logger.warn({ err: error, url: image.url }, "Failed to upload image");
      }
    }

    return uploadedImages;
  }

  /**
   * Create product variants
   */
  private async createProductVariants(
    productId: string,
    variants: FacebookProductVariant[]
  ): Promise<void> {
    for (const variant of variants) {
      const variantData: Record<string, unknown> = {
        price: variant.price * 100,
        availability: variant.availability,
        ...(variant.size && { size: variant.size }),
        ...(variant.color && { color: variant.color }),
        ...(variant.material && { material: variant.material }),
        ...(variant.pattern && { pattern: variant.pattern }),
        ...(variant.salePrice && { sale_price: variant.salePrice * 100 }),
        ...(variant.sku && { retailer_id: variant.sku }),
        ...(variant.gtin && { gtin: variant.gtin }),
        ...(variant.inventory !== undefined && { inventory: variant.inventory }),
      };

      try {
        await this.apiClient.makeApiRequest(`/${productId}/product_variants`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(variantData),
        });
      } catch (error) {
        logger.warn({ err: error }, "Failed to create product variant");
      }
    }
  }

  /**
   * Get product details
   */
  async getProductDetails(productId: string): Promise<FacebookProductResponse> {
    const response = await this.apiClient.makeApiRequest(
      `/${productId}?fields=id,name,description,brand,category,condition,currency,price,sale_price,availability,url,image_url,additional_image_urls,created_time,updated_time,visibility,review_status`
    );

    const data = await response.json();

    // Get product variants
    const variantsResponse = await this.apiClient.makeApiRequest(
      `/${productId}/product_variants?fields=id,size,color,material,pattern,price,sale_price,availability,inventory,retailer_id,gtin`
    );

    const variantsData = await variantsResponse.json();

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      ...(data.brand !== undefined && { brand: data.brand }),
      ...(data.category !== undefined && { category: data.category }),
      condition: data.condition,
      currency: data.currency,
      price: (data.price || 0) / 100, // Convert from cents
      ...(data.sale_price !== undefined && { salePrice: data.sale_price / 100 }),
      availability: data.availability,
      ...(data.url !== undefined && { url: data.url }),
      images: [
        {
          id: "main",
          url: data.image_url,
        },
        ...(data.additional_image_urls || []).map((url: string, index: number) => ({
          id: `additional_${index}`,
          url,
        })),
      ],
      variants: variantsData.data || [],
      createdTime: data.created_time,
      updatedTime: data.updated_time,
      status: "active" as const,
      ...(data.review_status !== undefined && { reviewStatus: data.review_status }),
      visibility: data.visibility || "published",
    };
  }

  /**
   * Update a product
   */
  async updateProduct(
    productId: string,
    updates: Partial<FacebookProductOptions>
  ): Promise<FacebookProductResponse> {
    const updateData: Record<string, unknown> = {};

    if (updates.name) updateData.name = updates.name;
    if (updates.description) updateData.description = updates.description;
    if (updates.brand) updateData.brand = updates.brand;
    if (updates.category) updateData.category = updates.category;
    if (updates.condition) updateData.condition = updates.condition;
    if (updates.url) updateData.url = updates.url;

    // Update main variant price if provided
    if (updates.variants?.[0]?.price) {
      updateData.price = updates.variants[0].price * 100;
    }

    if (updates.variants?.[0]?.availability) {
      updateData.availability = updates.variants[0].availability;
    }

    if (updates.variants?.[0]?.salePrice) {
      updateData.sale_price = updates.variants[0].salePrice * 100;
    }

    // Upload new images if provided
    if (updates.images?.length) {
      const uploadedImages = await this.uploadProductImages(updates.images);
      if (uploadedImages.length > 0) {
        updateData.image_url = uploadedImages[0]!.url;
        if (uploadedImages.length > 1) {
          updateData.additional_image_urls = uploadedImages.slice(1).map((img) => img.url);
        }
      }
    }

    await this.apiClient.makeApiRequest(`/${productId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateData),
    });

    return this.getProductDetails(productId);
  }

  /**
   * Delete a product
   */
  async deleteProduct(productId: string): Promise<boolean> {
    try {
      const response = await this.apiClient.makeApiRequest(`/${productId}`, {
        method: "DELETE",
      });

      const result = await response.json();
      return result.success === true;
    } catch (error) {
      logger.error({ err: error }, "Failed to delete product");
      return false;
    }
  }

  /**
   * Get catalog products
   */
  async getCatalogProducts(
    catalogId: string,
    limit = 25,
    after?: string
  ): Promise<{
    products: FacebookProductResponse[];
    hasNextPage: boolean;
    nextCursor?: string;
  }> {
    const params = new URLSearchParams({
      fields: "id,name,description,price,availability,image_url,created_time",
      limit: limit.toString(),
    });

    if (after) {
      params.append("after", after);
    }

    const response = await this.apiClient.makeApiRequest(`/${catalogId}/products?${params}`);

    const data = await response.json();

    return {
      products: data.data || [],
      hasNextPage: !!data.paging?.next,
      nextCursor: data.paging?.cursors?.after,
    };
  }

  /**
   * Create a product collection
   */
  async createCollection(
    catalogId: string,
    options: FacebookCollectionOptions
  ): Promise<FacebookCollectionResponse> {
    let coverImageId: string | undefined;

    if (options.coverImage) {
      const coverUpload = await this.apiClient.uploadUnpublishedMedia(options.coverImage, "photo");
      coverImageId = coverUpload.id;
    }

    const collectionData: Record<string, unknown> = {
      name: options.name,
      product_ids: options.productIds,
      ...(options.description && { description: options.description }),
      ...(coverImageId && { cover_photo: coverImageId }),
    };

    const response = await this.apiClient.makeApiRequest(`/${catalogId}/product_sets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(collectionData),
    });

    const result = await response.json();
    return this.getCollectionDetails(result.id);
  }

  /**
   * Get collection details
   */
  async getCollectionDetails(collectionId: string): Promise<FacebookCollectionResponse> {
    const response = await this.apiClient.makeApiRequest(
      `/${collectionId}?fields=id,name,description,product_count,created_time,updated_time`
    );

    const data = await response.json();

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      productCount: data.product_count || 0,
      createdTime: data.created_time,
      updatedTime: data.updated_time,
    };
  }
}
