export interface FacebookProductImage {
  url: string;
  altText?: string;
}

export interface FacebookProductVariant {
  id?: string;
  size?: string;
  color?: string;
  material?: string;
  pattern?: string;
  customLabel?: string;
  price: number;
  salePrice?: number;
  salePriceEffectiveDate?: {
    startDate: string;
    endDate: string;
  };
  availability: "in stock" | "out of stock" | "preorder" | "available for order";
  inventory?: number;
  sku?: string;
  gtin?: string; // Global Trade Item Number (UPC, EAN, etc.)
}

export interface FacebookProductOptions {
  name: string;
  description: string;
  brand?: string;
  category?: string;
  condition: "new" | "refurbished" | "used";
  currency: string;
  images: FacebookProductImage[];
  variants: FacebookProductVariant[];
  url?: string; // Product page URL
  additionalImageUrls?: string[];
  customLabels?: {
    customLabel0?: string;
    customLabel1?: string;
    customLabel2?: string;
    customLabel3?: string;
    customLabel4?: string;
  };
  googleProductCategory?: string;
  productType?: string;
  tags?: string[];
  ageGroup?: "adult" | "teen" | "kids" | "toddler" | "infant" | "newborn";
  gender?: "male" | "female" | "unisex";
  material?: string;
  pattern?: string;
  size?: string;
  sizeType?: "regular" | "petite" | "plus" | "big and tall" | "maternity";
  sizeSystem?: "US" | "UK" | "EU" | "DE" | "FR" | "JP" | "CN" | "IT" | "BR" | "MEX" | "AU";
  weight?: {
    value: number;
    unit: "kg" | "lb" | "oz" | "g";
  };
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: "cm" | "in";
  };
  shippingWeight?: {
    value: number;
    unit: "kg" | "lb" | "oz" | "g";
  };
  origin?: string; // Country of origin
  isBundle?: boolean;
  multipack?: number;
  energyEfficiencyClass?: string;
  minEnergyEfficiencyClass?: string;
  maxEnergyEfficiencyClass?: string;
}

export interface FacebookProductResponse {
  id: string;
  name: string;
  description: string;
  brand?: string;
  category?: string;
  condition: string;
  currency: string;
  price: number;
  salePrice?: number;
  availability: string;
  url?: string;
  images: Array<{
    id: string;
    url: string;
    altText?: string;
  }>;
  variants: FacebookProductVariant[];
  createdTime: string;
  updatedTime: string;
  status: "active" | "archived" | "rejected";
  reviewStatus?: "pending" | "approved" | "rejected";
  visibility: "published" | "staging";
}

export interface FacebookCatalogOptions {
  name: string;
  verticalType:
    | "commerce"
    | "auto"
    | "destinations"
    | "flights"
    | "hotels"
    | "jobs"
    | "local_deals"
    | "real_estate"
    | "generic";
  description?: string;
  defaultImageUrl?: string;
  brand?: string;
  contentType?:
    | "product"
    | "destination"
    | "flight"
    | "hotel"
    | "local_deal"
    | "job"
    | "vehicle"
    | "home_listing";
}

export interface FacebookCatalogResponse {
  id: string;
  name: string;
  verticalType: string;
  description?: string;
  productCount: number;
  brand?: string;
  createdTime: string;
  updatedTime: string;
  defaultImageUrl?: string;
  contentType: string;
}

export interface FacebookShopSection {
  id?: string;
  name: string;
  description?: string;
  productIds: string[];
  isActive?: boolean;
  order?: number;
}

export interface FacebookShopConfiguration {
  sections: FacebookShopSection[];
  headerImage?: string;
  description?: string;
  isEnabled: boolean;
  merchantSettings?: {
    contactEmail?: string;
    privacyPolicyUrl?: string;
    termsOfServiceUrl?: string;
    returnPolicyUrl?: string;
    shippingPolicyUrl?: string;
    supportUrl?: string;
  };
  paymentSettings?: {
    acceptedPaymentMethods: ("paypal" | "stripe" | "facebook_pay")[];
    currency: string;
    taxSettings?: {
      includesTax: boolean;
      taxRate?: number;
    };
  };
}

export interface FacebookProductInsights {
  productId: string;
  impressions: number;
  reach: number;
  clicks: number;
  purchases: number;
  revenue: number;
  addToCart: number;
  viewContent: number;
  initiateCheckout: number;
  purchaseValue: number;
  costPerResult: number;
  returnOnAdSpend: number;
  period: {
    since: string;
    until: string;
  };
  demographics?: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    countries: Record<string, number>;
  };
  topPerformingVariants?: Array<{
    variantId: string;
    purchases: number;
    revenue: number;
  }>;
}

export interface FacebookCollectionOptions {
  name: string;
  description?: string;
  productIds: string[];
  coverImage?: string;
  tags?: string[];
}

export interface FacebookCollectionResponse {
  id: string;
  name: string;
  description?: string;
  productCount: number;
  coverImage?: {
    id: string;
    url: string;
  };
  createdTime: string;
  updatedTime: string;
}
