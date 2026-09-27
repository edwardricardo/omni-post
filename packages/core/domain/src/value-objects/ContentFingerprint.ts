/**
 * @file ContentFingerprint.ts
 * @description Fingerprint of the locked content exactly as it was handed to a
 *   provider — the body plus the ORDERED media identifiers. It answers "what went out,
 *   where" from the record alone and takes no part in any retry decision.
 * @layer domain
 */

import { createHash } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

/** The canonical inputs: the body, then the media in the order they were attached. */
export interface ContentFingerprintInput {
  body: string;
  mediaIds: readonly string[];
}

const HASH_ALGORITHM = "sha256";
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * @class ContentFingerprint
 * @description Immutable digest of the published content. Media ORDER is part of the
 *   fingerprint: a carousel whose slides were reordered is not the same publication.
 */
export class ContentFingerprint {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  /**
   * @method ofContent
   * @description Computes the fingerprint over the canonical form of the content.
   *   The canonical form is serialised with the body first and the media identifiers
   *   in their attachment order, so the same content always hashes the same way and
   *   a reorder always changes it.
   * @param input - The body and the ordered media identifiers
   * @returns The fingerprint
   */
  static ofContent(input: ContentFingerprintInput): ContentFingerprint {
    const canonical = JSON.stringify({ body: input.body, media: [...input.mediaIds] });
    return new ContentFingerprint(createHash(HASH_ALGORITHM).update(canonical).digest("hex"));
  }

  /**
   * @method fromString
   * @description Reads a persisted fingerprint back, refusing anything that is not a
   *   digest of the expected algorithm.
   * @param value - The stored hexadecimal digest
   * @returns Result with the fingerprint, or InvalidValueError
   */
  static fromString(value: string): Result<ContentFingerprint, InvalidValueError> {
    if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
      return err(
        new InvalidValueError(
          "ContentFingerprint",
          value,
          "A content fingerprint is a 64-character lowercase hexadecimal digest"
        )
      );
    }
    return ok(new ContentFingerprint(value));
  }

  get value(): string {
    return this._value;
  }

  /**
   * @method equals
   * @description Value equality over the digest.
   * @param other - The fingerprint to compare against
   * @returns true when both digests match
   */
  equals(other: ContentFingerprint): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }
}

/**
 * @function digestOfFragments
 * @description Digest of an ordered set of fragment references — the value the record
 *   compares to decide whether the customer has already been alerted about EXACTLY
 *   this live set. It lives beside the content fingerprint because both are the same
 *   mechanism: a stable digest over a canonical form.
 * @param entries - The ordered `{ index, externalId }` pairs of the live fragments
 * @returns The hexadecimal digest
 */
export function digestOfFragments(
  entries: readonly { index: number; externalId: string }[]
): string {
  const canonical = JSON.stringify(
    entries.map((entry) => [entry.index, entry.externalId] as const)
  );
  return createHash(HASH_ALGORITHM).update(canonical).digest("hex");
}
