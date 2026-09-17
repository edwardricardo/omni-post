/**
 * @file ContentLockedError.ts
 * @description The refusal raised when a write is attempted on a post whose content is
 *   LIVE on a provider. It is deliberately a different error from the lifecycle
 *   refusal: "you cannot edit this yet" and "this is already published somewhere" are
 *   different facts, they need different words in front of a customer, and only the
 *   second one names content that has to come down first.
 * @layer domain
 */

import { DomainError } from "./DomainError.js";
import { type FragmentReferenceJson } from "../value-objects/FragmentReference.js";

export const CONTENT_LOCKED_CODE = "CONTENT_LOCKED";

export interface ContentLockedErrorProps {
  postId?: string;
  channelId: string;
  /** Empty for a fully published channel; the live prefix for an interrupted one. */
  fragments?: readonly FragmentReferenceJson[];
  pendingRetraction?: boolean;
  operation?: string;
}

/**
 * @class ContentLockedError
 * @description Names the channel that holds content live, and — when the channel is
 *   pending retraction — the exact fragments the customer has to deal with. A
 *   summarised refusal would leave them nothing to act on.
 */
export class ContentLockedError extends DomainError {
  public readonly postId: string | undefined;
  public readonly channelId: string;
  public readonly fragments: readonly FragmentReferenceJson[];
  public readonly pendingRetraction: boolean;
  public readonly operation: string | undefined;

  constructor(props: ContentLockedErrorProps) {
    const fragments = props.fragments ?? [];
    const named =
      fragments.length > 0
        ? ` — live fragments: ${fragments.map((fragment) => fragment.externalId).join(", ")}`
        : "";
    super(
      `Post content is locked: channel ${props.channelId} holds live content${named}`,
      CONTENT_LOCKED_CODE
    );
    this.postId = props.postId;
    this.channelId = props.channelId;
    this.fragments = fragments;
    this.pendingRetraction = props.pendingRetraction ?? fragments.length > 0;
    this.operation = props.operation;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      ...(this.postId !== undefined && { postId: this.postId }),
      channelId: this.channelId,
      fragments: this.fragments.map((fragment) => ({ ...fragment })),
      pendingRetraction: this.pendingRetraction,
      ...(this.operation !== undefined && { operation: this.operation }),
    };
  }
}
