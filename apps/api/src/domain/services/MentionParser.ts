/**
 * @file MentionParser.ts
 * @description Pure domain service for parsing @mention markup in text content.
 *   Mention format: @[DisplayName](customerUserId)
 *   No external dependencies -- all functions are pure and stateless.
 * @layer domain
 */

/**
 * Represents a single parsed mention extracted from text content.
 */
export interface ParsedMention {
  readonly displayName: string;
  readonly customerUserId: string;
  /** The full raw match string, e.g. "@[Alice](uuid-123)" */
  readonly raw: string;
}

/**
 * Regex pattern matching the @[DisplayName](customerUserId) format.
 * Captures: group 1 = display name, group 2 = customer user ID
 */
const MENTION_PATTERN = /@\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * @class MentionParser
 * @description Stateless domain service that extracts, validates, and transforms
 *   @mention markup within text content. All methods are static pure functions.
 */
export class MentionParser {
  /**
   * @method parse
   * @description Extracts all mentions from the given text.
   * @param text - The text content potentially containing mentions
   * @returns Array of ParsedMention objects found in the text
   */
  static parse(text: string): ParsedMention[] {
    const mentions: ParsedMention[] = [];
    const regex = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags);
    let match = regex.exec(text);

    while (match !== null) {
      const displayName = match[1];
      const customerUserId = match[2];

      if (displayName && customerUserId) {
        mentions.push({
          displayName,
          customerUserId,
          raw: match[0],
        });
      }

      match = regex.exec(text);
    }

    return mentions;
  }

  /**
   * @method validate
   * @description Checks whether all mentioned CustomerUser IDs exist in the
   *   provided set of valid account-scoped CustomerUser IDs.
   * @param mentions - Array of parsed mentions to validate
   * @param accountCustomerUserIds - Set or array of valid CustomerUser IDs for the account
   * @returns true if every mention references a valid CustomerUser ID, false otherwise
   */
  static validate(
    mentions: readonly ParsedMention[],
    accountCustomerUserIds: readonly string[]
  ): boolean {
    if (mentions.length === 0) {
      return true;
    }
    const validIds = new Set(accountCustomerUserIds);
    return mentions.every((m) => validIds.has(m.customerUserId));
  }

  /**
   * @method toPlainText
   * @description Strips mention markup from text, replacing each @[Name](id)
   *   with plain @Name for human-readable display.
   * @param text - The text content containing mention markup
   * @returns Text with mention markup replaced by plain @Name references
   */
  static toPlainText(text: string): string {
    return text.replace(
      new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags),
      (_match, displayName: string) => `@${displayName}`
    );
  }

  /**
   * @method extractUniqueIds
   * @description Extracts a deduplicated array of CustomerUser IDs from the text.
   * @param text - The text content containing mentions
   * @returns Array of unique CustomerUser IDs mentioned in the text
   */
  static extractUniqueIds(text: string): string[] {
    const mentions = MentionParser.parse(text);
    return [...new Set(mentions.map((m) => m.customerUserId))];
  }
}
