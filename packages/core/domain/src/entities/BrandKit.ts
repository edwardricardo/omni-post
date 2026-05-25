/**
 * @file BrandKit.ts
 * @description Domain entity for brand kit configuration. Validates hex color formats
 *              and manages visual brand identity (colors, logos, fonts) per account.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";

/** Hex color regex: #RRGGBB (case-insensitive) */
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export interface BrandKitProps {
  readonly id: string;
  readonly accountId: string;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly accentColor?: string;
  readonly logoUrl?: string;
  readonly logoStorageKey?: string;
  readonly fontPrimary?: string;
  readonly fontSecondary?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateBrandKitInput {
  accountId: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  logoStorageKey?: string;
  fontPrimary?: string;
  fontSecondary?: string;
}

export interface UpdateBrandKitInput {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  logoStorageKey?: string;
  fontPrimary?: string;
  fontSecondary?: string;
}

export class BrandKitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandKitValidationError";
  }
}

export class BrandKit {
  private constructor(private readonly props: BrandKitProps) {}

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get primaryColor(): string | undefined {
    return this.props.primaryColor;
  }
  get secondaryColor(): string | undefined {
    return this.props.secondaryColor;
  }
  get accentColor(): string | undefined {
    return this.props.accentColor;
  }
  get logoUrl(): string | undefined {
    return this.props.logoUrl;
  }
  get logoStorageKey(): string | undefined {
    return this.props.logoStorageKey;
  }
  get fontPrimary(): string | undefined {
    return this.props.fontPrimary;
  }
  get fontSecondary(): string | undefined {
    return this.props.fontSecondary;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * @method create
   * @description Creates a new BrandKit entity. Validates hex color formats.
   * @param input - Brand kit creation parameters
   * @returns Result with BrandKit on success, BrandKitValidationError on failure
   */
  static create(input: CreateBrandKitInput): Result<BrandKit, BrandKitValidationError> {
    if (!input.accountId) {
      return err(new BrandKitValidationError("accountId is required"));
    }

    const colorValidation = BrandKit.validateColors(input);
    if (colorValidation) {
      return err(colorValidation);
    }

    const now = new Date();
    return ok(
      new BrandKit({
        id: "",
        accountId: input.accountId,
        ...(input.primaryColor !== undefined && { primaryColor: input.primaryColor }),
        ...(input.secondaryColor !== undefined && { secondaryColor: input.secondaryColor }),
        ...(input.accentColor !== undefined && { accentColor: input.accentColor }),
        ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
        ...(input.logoStorageKey !== undefined && { logoStorageKey: input.logoStorageKey }),
        ...(input.fontPrimary !== undefined && { fontPrimary: input.fontPrimary }),
        ...(input.fontSecondary !== undefined && { fontSecondary: input.fontSecondary }),
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  /**
   * @method reconstitute
   * @description Reconstitutes a BrandKit from persisted data. No validation.
   */
  static reconstitute(props: BrandKitProps): BrandKit {
    return new BrandKit(props);
  }

  /**
   * @method update
   * @description Updates the brand kit with new data. Validates hex colors.
   * @param data - Partial update parameters
   * @returns Result with updated BrandKit on success
   */
  update(data: UpdateBrandKitInput): Result<BrandKit, BrandKitValidationError> {
    const colorValidation = BrandKit.validateColors(data);
    if (colorValidation) {
      return err(colorValidation);
    }

    return ok(
      new BrandKit({
        ...this.props,
        ...(data.primaryColor !== undefined && { primaryColor: data.primaryColor }),
        ...(data.secondaryColor !== undefined && { secondaryColor: data.secondaryColor }),
        ...(data.accentColor !== undefined && { accentColor: data.accentColor }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.logoStorageKey !== undefined && { logoStorageKey: data.logoStorageKey }),
        ...(data.fontPrimary !== undefined && { fontPrimary: data.fontPrimary }),
        ...(data.fontSecondary !== undefined && { fontSecondary: data.fontSecondary }),
        updatedAt: new Date(),
      })
    );
  }

  /**
   * @method toJSON
   * @description Serializes the brand kit to a plain object.
   */
  toJSON(): BrandKitProps {
    return { ...this.props };
  }

  /**
   * Validates color fields. Returns error if any provided color is not valid #RRGGBB.
   */
  private static validateColors(
    input: Partial<Pick<BrandKitProps, "primaryColor" | "secondaryColor" | "accentColor">>
  ): BrandKitValidationError | null {
    const colorFields = [
      { name: "primaryColor", value: input.primaryColor },
      { name: "secondaryColor", value: input.secondaryColor },
      { name: "accentColor", value: input.accentColor },
    ] as const;

    for (const field of colorFields) {
      if (field.value !== undefined && field.value !== null && !HEX_COLOR_REGEX.test(field.value)) {
        return new BrandKitValidationError(
          `${field.name} must be a valid hex color (#RRGGBB format)`
        );
      }
    }

    return null;
  }
}
