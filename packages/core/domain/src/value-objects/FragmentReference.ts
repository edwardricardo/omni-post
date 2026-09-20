/**
 * @file FragmentReference.ts
 * @description Value object for ONE fragment of a post as it exists on a provider:
 *   its position in the thread, the provider's identifier for it, and the address a
 *   human can open. A post that publishes as several fragments is recorded fragment
 *   by fragment, so "which pieces are live" is answerable from the record alone.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

/**
 * The persisted shape of a fragment reference. It is the JSON stored in the
 * record's live-fragment array, so it is also the shape a mapper parses back.
 */
export interface FragmentReferenceJson {
  index: number;
  externalId: string;
  url?: string;
}

/** Construction input — identical to the persisted shape. */
export type FragmentReferenceProps = FragmentReferenceJson;

/**
 * @class FragmentReference
 * @description Immutable reference to one published fragment. Fragment positions are
 *   one-based: fragment 1 is the head of a thread and the item itself for a post that
 *   publishes as a single piece.
 */
export class FragmentReference {
  private readonly _index: number;
  private readonly _externalId: string;
  private readonly _url: string | undefined;

  private constructor(index: number, externalId: string, url: string | undefined) {
    this._index = index;
    this._externalId = externalId;
    this._url = url;
  }

  /**
   * @method create
   * @description Builds a fragment reference, validating the position and the
   *   provider identifier.
   * @param props - Position, provider identifier and optional address
   * @returns Result with the reference, or InvalidValueError naming the offending field
   */
  static create(props: FragmentReferenceProps): Result<FragmentReference, InvalidValueError> {
    if (!Number.isInteger(props.index) || props.index < 1) {
      return err(
        new InvalidValueError(
          "FragmentReference.index",
          props.index,
          "Fragment index must be an integer of 1 or more — positions are one-based"
        )
      );
    }

    const externalId = typeof props.externalId === "string" ? props.externalId.trim() : "";
    if (externalId.length === 0) {
      return err(
        new InvalidValueError(
          "FragmentReference.externalId",
          props.externalId,
          "Fragment external id cannot be empty — an unaddressable fragment is not a reference"
        )
      );
    }

    const url = typeof props.url === "string" ? props.url.trim() : undefined;
    if (props.url !== undefined && (url === undefined || url.length === 0)) {
      return err(
        new InvalidValueError(
          "FragmentReference.url",
          props.url,
          "Fragment url, when present, cannot be empty"
        )
      );
    }

    return ok(new FragmentReference(props.index, externalId, url));
  }

  /**
   * @method fromJSON
   * @description Parses a persisted entry back into a reference. The column is
   *   untyped JSON, so an entry that does not match the shape is refused here rather
   *   than read as a half-valid reference further up.
   * @param value - One entry of the persisted live-fragment array
   * @returns Result with the reference, or InvalidValueError
   */
  static fromJSON(value: unknown): Result<FragmentReference, InvalidValueError> {
    if (typeof value !== "object" || value === null) {
      return err(
        new InvalidValueError("FragmentReference", value, "Fragment entry must be an object")
      );
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate.index !== "number" || typeof candidate.externalId !== "string") {
      return err(
        new InvalidValueError(
          "FragmentReference",
          value,
          "Fragment entry must carry a numeric index and a string external id"
        )
      );
    }

    return FragmentReference.create({
      index: candidate.index,
      externalId: candidate.externalId,
      ...(typeof candidate.url === "string" && { url: candidate.url }),
    });
  }

  get index(): number {
    return this._index;
  }

  get externalId(): string {
    return this._externalId;
  }

  get url(): string | undefined {
    return this._url;
  }

  /**
   * @method equals
   * @description Value equality over every field.
   * @param other - The reference to compare against
   * @returns true when position, identifier and address all match
   */
  equals(other: FragmentReference): boolean {
    return (
      this._index === other._index &&
      this._externalId === other._externalId &&
      this._url === other._url
    );
  }

  toJSON(): FragmentReferenceJson {
    return {
      index: this._index,
      externalId: this._externalId,
      ...(this._url !== undefined && { url: this._url }),
    };
  }
}

/**
 * @function sortFragments
 * @description Returns the fragments ordered by position. The record keeps them in
 *   thread order so a customer reading the alert sees the prefix that went out in the
 *   order it went out.
 * @param fragments - The fragments to order
 * @returns A new ordered array
 */
export function sortFragments(
  fragments: readonly FragmentReference[]
): readonly FragmentReference[] {
  return [...fragments].sort((a, b) => a.index - b.index);
}
