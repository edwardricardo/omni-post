/**
 * @file MentionParser.ts
 * @description Pure domain service for parsing @mention markup in text content.
 *   Mention format: @[DisplayName](teamMemberId)
 *   No external dependencies -- all functions are pure and stateless.
 * @layer domain
 */

/**
 * Represents a single parsed mention extracted from text content.
 */
export interface ParsedMention {
  readonly displayName: string;
  readonly teamMemberId: string;
  /** The full raw match string, e.g. "@[Alice](uuid-123)" */
  readonly raw: string;
}

/**
 * Regex pattern matching the @[DisplayName](teamMemberId) format.
 * Captures: group 1 = display name, group 2 = team member ID
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
      const teamMemberId = match[2];

      if (displayName && teamMemberId) {
        mentions.push({
          displayName,
          teamMemberId,
          raw: match[0],
        });
      }

      match = regex.exec(text);
    }

    return mentions;
  }

  /**
   * @method validate
   * @description Checks whether all mentioned team member IDs exist in the
   *   provided set of valid account team member IDs.
   * @param mentions - Array of parsed mentions to validate
   * @param accountTeamMemberIds - Set or array of valid team member IDs for the account
   * @returns true if every mention references a valid team member ID, false otherwise
   */
  static validate(
    mentions: readonly ParsedMention[],
    accountTeamMemberIds: readonly string[]
  ): boolean {
    if (mentions.length === 0) {
      return true;
    }
    const validIds = new Set(accountTeamMemberIds);
    return mentions.every((m) => validIds.has(m.teamMemberId));
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
   * @description Extracts a deduplicated array of team member IDs from the text.
   * @param text - The text content containing mentions
   * @returns Array of unique team member IDs mentioned in the text
   */
  static extractUniqueIds(text: string): string[] {
    const mentions = MentionParser.parse(text);
    return [...new Set(mentions.map((m) => m.teamMemberId))];
  }
}
