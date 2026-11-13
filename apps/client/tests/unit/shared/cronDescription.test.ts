/**
 * @file cronDescription.test.ts
 * @description Pins that every language of the routing has a cronstrue locale loaded and mapped,
 *   so a language added to `routing.locales` without one fails here, and that a locale outside
 *   the routing is not described as if it were supported.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import cronstrue from "cronstrue";
import { routing } from "@/i18n/routing";
import { CRONSTRUE_LOCALES, describeCron } from "@/lib/utils/cronDescription";

const EVERY_FIVE_MINUTES = "*/5 * * * *";

describe("cron description locales", () => {
  it.each(routing.locales)(
    "maps the %s routing language to a loaded cronstrue locale",
    (locale) => {
      const mapped = (CRONSTRUE_LOCALES as Record<string, string | undefined>)[locale];

      expect(mapped, `no cronstrue locale mapped for routing language ${locale}`).toBeDefined();
      expect(Object.keys(cronstrue.locales)).toContain(mapped);
    }
  );

  it.each(routing.locales)("describes a cron in the %s routing language", (locale) => {
    const description = describeCron(EVERY_FIVE_MINUTES, locale, { use24HourTimeFormat: true });

    expect(description).not.toBe(EVERY_FIVE_MINUTES);
    expect(description).toBe(
      cronstrue.toString(EVERY_FIVE_MINUTES, {
        use24HourTimeFormat: true,
        locale: (CRONSTRUE_LOCALES as Record<string, string>)[locale],
      })
    );
  });

  it("describes the same cron differently in Spanish and English", () => {
    const english = describeCron(EVERY_FIVE_MINUTES, "en", { use24HourTimeFormat: true });
    const spanish = describeCron(EVERY_FIVE_MINUTES, "es", { use24HourTimeFormat: true });

    expect(english).toBe("Every 5 minutes");
    expect(spanish).toBe("Cada 5 minutos");
  });

  it("returns the raw expression for a locale outside the routing", () => {
    expect(describeCron(EVERY_FIVE_MINUTES, "fr", { use24HourTimeFormat: true })).toBe(
      EVERY_FIVE_MINUTES
    );
  });

  it("returns the raw expression when the cron cannot be read", () => {
    expect(describeCron("not a cron", "es", { use24HourTimeFormat: true })).toBe("not a cron");
  });
});
