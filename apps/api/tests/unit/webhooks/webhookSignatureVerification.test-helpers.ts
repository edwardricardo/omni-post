import { createHmac } from "node:crypto";
import {
  AbstractWebhookProcessor,
  type RelatedEntities,
} from "../../../src/webhooks/processors/AbstractWebhookProcessor.js";
import type { WebhookEventType } from "@shared/types";

export function signPayload(rawBody: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function tamperSignature(sig: string): string {
  const lastChar = sig.charAt(sig.length - 1);
  const replacement = lastChar === "a" ? "b" : "a";
  return sig.slice(0, -1) + replacement;
}

export class StubHexProcessor extends AbstractWebhookProcessor {
  protected override providerId = "INSTAGRAM" as const;
  protected override signaturePrefix = "sha256=";
  protected override signatureEncoding: "hex" | "base64" = "hex";

  protected override async parsePayload(_payload: Record<string, any>): Promise<{
    eventType: WebhookEventType;
    normalizedData: Record<string, any>;
  }> {
    return {
      eventType: "POST_UPDATED",
      normalizedData: { eventType: "stub" },
    };
  }

  protected override async resolveRelatedEntities(): Promise<RelatedEntities> {
    return {};
  }

  protected override async processEvent(): Promise<void> {}
}

export class Base64StubProcessor extends AbstractWebhookProcessor {
  protected override providerId = "X" as const;
  protected override signaturePrefix = "sha256=";
  protected override signatureEncoding: "hex" | "base64" = "base64";

  protected override async parsePayload(_p: Record<string, any>): Promise<{
    eventType: WebhookEventType;
    normalizedData: Record<string, any>;
  }> {
    return { eventType: "POST_UPDATED", normalizedData: { eventType: "stub" } };
  }

  protected override async resolveRelatedEntities(): Promise<RelatedEntities> {
    return {};
  }

  protected override async processEvent(): Promise<void> {}
}
