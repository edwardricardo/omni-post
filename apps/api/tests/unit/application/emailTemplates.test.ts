/**
 * @file emailTemplates.test.ts
 * @description Unit tests for react-email notification templates.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  approvalRequestedEmail,
  approvalDecisionEmail,
  taskAssignedEmail,
  mentionEmail,
} from "../../../src/infrastructure/email/templates/emailTemplates.js";

describe("approvalRequestedEmail", () => {
  it("includes post title in subject", async () => {
    const { subject } = await approvalRequestedEmail({
      authorName: "Alice",
      postTitle: "Spring Campaign",
      postPreview: "Check out our new spring collection",
      platforms: ["Instagram", "LinkedIn"],
      reviewUrl: "https://app.omnipost.com/dashboard/approvals",
      accountName: "Acme Corp",
    });
    assert.ok(subject.includes("Spring Campaign"));
  });

  it("includes author name and CTA link in HTML", async () => {
    const { html } = await approvalRequestedEmail({
      authorName: "Bob",
      postTitle: "Test Post",
      postPreview: "Short preview",
      platforms: ["X"],
      reviewUrl: "http://localhost:3002/dashboard/approvals",
      accountName: "Test Corp",
    });
    assert.ok(html.includes("Bob"));
    assert.ok(html.includes("dashboard/approvals"));
    assert.ok(html.length > 100);
  });
});

describe("approvalDecisionEmail", () => {
  it("renders approved variant", async () => {
    const { subject, html } = await approvalDecisionEmail({
      decision: "approved",
      reviewerName: "Jane",
      postTitle: "Q2 Campaign",
      postUrl: "http://localhost:3002/dashboard/posts/123",
      accountName: "Acme",
    });
    assert.ok(subject.includes("approved"));
    assert.ok(html.includes("Jane"));
    assert.ok(html.includes("approved"));
  });

  it("renders rejected variant with reason", async () => {
    const { subject, html } = await approvalDecisionEmail({
      decision: "rejected",
      reviewerName: "Admin",
      postTitle: "Draft Post",
      rejectionReason: "Needs more context about the product",
      postUrl: "http://localhost:3002/dashboard/posts/456",
      accountName: "Beta Inc",
    });
    assert.ok(subject.includes("Changes requested"));
    assert.ok(html.includes("Needs more context"));
  });
});

describe("taskAssignedEmail", () => {
  it("includes task title and priority", async () => {
    const { subject, html } = await taskAssignedEmail({
      assignerName: "Manager",
      taskTitle: "Review social calendar",
      taskDescription: "Please review the Q3 content calendar",
      priority: "HIGH",
      dueDate: "April 15, 2026",
      taskUrl: "http://localhost:3002/dashboard/tasks",
      accountName: "Acme Corp",
    });
    assert.ok(subject.includes("Review social calendar"));
    assert.ok(html.includes("HIGH"));
    assert.ok(html.includes("April 15"));
  });
});

describe("mentionEmail", () => {
  it("includes mentioner name and context", async () => {
    const { subject, html } = await mentionEmail({
      mentionerName: "Alice",
      context: "task",
      textPreview: "Hey @bob, can you review this?",
      contextUrl: "http://localhost:3002/dashboard/inbox",
      accountName: "Acme Corp",
    });
    assert.ok(subject.includes("Alice"));
    assert.ok(subject.includes("task"));
    assert.ok(html.includes("mentioned you"));
  });
});
