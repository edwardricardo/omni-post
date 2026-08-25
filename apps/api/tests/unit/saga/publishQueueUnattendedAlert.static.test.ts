/**
 * @file publishQueueUnattendedAlert.static.test.ts
 * @description Merge-blocking scan over the alert rules that make a publish
 *              consumer outage audible before the saga horizon terminalizes the
 *              cohort under it. Three properties are pinned because each has a
 *              plausible "improvement" that silently removes the alert's value:
 *              adding a backlog threshold (which is what makes the pre-existing
 *              rule blind at this system's volume), widening the window past the
 *              horizon (so the operator hears about it after the damage), and
 *              dropping the absent-series companion (so the alert goes quiet at
 *              the exact moment closest to the incident).
 *
 *              The pre-existing backlog rule is asserted byte-for-byte in the
 *              other direction: this change must not weaken it to make its own
 *              signal look necessary.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(currentDir, "..", "..", "..");
const repoRoot = join(apiRoot, "..", "..");

const alerts = readFileSync(join(repoRoot, "prometheus", "alerts", "saga.yml"), "utf8");
const runbookPath = join(repoRoot, "docs", "runbooks", "alert-saga-timeout.md");

/** The saga terminal horizon, in minutes — the bound every window is measured against. */
const SAGA_HORIZON_MINUTES = 30;

/** One alert's YAML block, from its `- alert:` line to the next one. */
function alertBlock(name: string): string {
  const start = alerts.indexOf(`- alert: ${name}`);
  if (start === -1) return "";
  const next = alerts.indexOf("- alert:", start + 1);
  return next === -1 ? alerts.slice(start) : alerts.slice(start, next);
}

/** `[Nm]` lookback and `for: Nm` hold, in minutes. */
function windowMinutes(block: string): { lookback: number; hold: number } {
  const lookback = Number(/\[(\d+)m\]/.exec(block)?.[1] ?? "0");
  const hold = Number(/\n\s+for:\s*(\d+)m/.exec(block)?.[1] ?? "0");
  return { lookback, hold };
}

describe("an unattended publish queue is audible inside the saga horizon", () => {
  it("declares the rule with BOTH terms: work queued and nobody taking it", () => {
    // Consumers alone pages on a deliberate scale-to-zero over an empty queue.
    // Waiting alone pages on an ordinary burst. Only together do they say the
    // thing an operator can act on.
    const block = alertBlock("PublishQueueUnattended");

    expect(block).not.toBe("");
    expect(block).toContain("publish_queue_consumers");
    expect(block).toContain("publish_queue_waiting");
    expect(block).toContain("runbook:");
  });

  it("keys attendance on a ceiling, so one observed consumer proves attendance", () => {
    // `max_over_time(...) == 0` reads as "not once in the whole lookback". A
    // floor would be satisfied by a single bad scrape. The unknown sentinel is
    // negative, so it fails `== 0` and cannot page on an unanswered question.
    const block = alertBlock("PublishQueueUnattended");

    expect(block).toMatch(/max_over_time\(publish_queue_consumers\[\d+m\]\)\s*==\s*0/);
  });

  it("is satisfiable at no more than one third of the saga horizon", () => {
    // R5-b's arithmetic, asserted rather than described: lookback + hold is when
    // the rule can first fire. Beyond a third of the horizon, the operator hears
    // about the outage too late to act before the cohort terminalizes under it.
    const { lookback, hold } = windowMinutes(alertBlock("PublishQueueUnattended"));

    expect(lookback).toBeGreaterThan(0);
    expect(hold).toBeGreaterThan(0);
    expect(lookback + hold).toBeLessThanOrEqual(SAGA_HORIZON_MINUTES / 3);
  });

  it("carries no backlog threshold, so a single affected publish is enough", () => {
    // Volume-gating is exactly what makes the pre-existing rule silent here: at
    // this system's volume a total outage never reaches its floor. A `> N`
    // against the waiting depth would reintroduce that blindness.
    const block = alertBlock("PublishQueueUnattended");
    const waitingTerm = /publish_queue_waiting\[\d+m\]\)\s*([<>=]+)\s*(\d+)/.exec(block);

    expect(waitingTerm).not.toBeNull();
    expect({ comparator: waitingTerm?.[1], threshold: waitingTerm?.[2] }).toEqual({
      comparator: ">",
      threshold: "0",
    });
  });

  it("guards its own series, because an absent series stops firing silently", () => {
    // `max_over_time` over an absent series yields no result: if the API is down
    // or the provider throws — the case CLOSEST to the incident — the primary
    // rule quietly stops evaluating. The companion says so out loud.
    const block = alertBlock("PublishQueueSignalMissing");

    expect(block).not.toBe("");
    expect(block).toMatch(/absent_over_time\(publish_queue_consumers\[\d+m\]\)/);
    expect(block).toContain("runbook:");
  });

  it("leaves the pre-existing backlog rule's expression, threshold and hold untouched", () => {
    // It answers a different question and keeps answering it. Lowering ITS
    // threshold instead of adding this rule would be noisy on a busy system and
    // still silent on a quiet one — the wrong axis at every threshold.
    const block = alertBlock("SagaWaitingRowsAccumulating");

    expect(block).toContain("expr: min_over_time(saga_waiting_rows[15m]) > 50");
    expect(block).toMatch(/\n\s+for:\s*10m/);
  });

  it("names a runbook that exists and states the operator meaning", () => {
    // An alert whose runbook does not exist, or exists and does not cover this
    // cause, is a link that costs the operator time at the worst moment.
    expect(existsSync(runbookPath)).toBe(true);
    const runbook = readFileSync(runbookPath, "utf8");

    // The runbook is written in the language the rest of that document uses, so
    // the phrasings below accept either — the assertion is about the STATEMENT
    // being present, not about which language states it.
    expect({
      namesTheAlert: runbook.includes("PublishQueueUnattended"),
      // The reading that prevents a destructive retry: the cohort terminalizes
      // under reason="timeout", and that does NOT prove nothing was published.
      statesTheTerminalReason: /reason="timeout"|reason='timeout'/.test(runbook),
      warnsBeforeRetrying:
        /does not (prove|mean) (that )?nothing was published/i.test(runbook) ||
        /NO prueba que no se haya publicado nada/i.test(runbook),
      // Every rule in this repo is evaluated but routed nowhere yet; a runbook
      // that implies someone gets paged is a promise the system does not keep.
      statesRoutingIsPending: /routing pending/i.test(runbook),
    }).toEqual({
      namesTheAlert: true,
      statesTheTerminalReason: true,
      warnsBeforeRetrying: true,
      statesRoutingIsPending: true,
    });
  });
});
