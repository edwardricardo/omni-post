/**
 * @file createStoryPreview.test.tsx
 * @description Pins the Storybook preview both portals share, through the object
 *   `createStoryPreview` returns: the theme and locale the decorator renders a story in, for a
 *   valid and an unknown global; the catalog it hands the intl provider, found by the file name's
 *   ending, or an empty one; the initial globals; and the theme and locale toolbars. It also pins
 *   `tokenColor`, which the portals' stories run in Chromium and which jsdom resolves too. The
 *   suite sits in the admin's unit suite because `@packages/ui`, the package that owns the
 *   module, has no unit runner of its own.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  createStoryPreview,
  tokenColor,
  type StoryIntlProviderProps,
  type StoryMessages,
} from "@packages/ui/storybook";

const LOCALES = ["en", "es", "fr"] as const;
type Locale = (typeof LOCALES)[number];

const EN_MESSAGES: StoryMessages = { greeting: "Hello" };
const ES_MESSAGES: StoryMessages = { greeting: "Hola" };
const KEN_MESSAGES: StoryMessages = { greeting: "Not the English catalog" };

/** What the decorator rendered around a story, read back from the DOM. */
interface RenderedFrame {
  /** The class of the element that carries `data-theme`. */
  themeClass: string | undefined;
  /** That element's `data-theme`. */
  theme: string | null;
  /** The locale the intl provider received. */
  locale: string | undefined;
  /** The catalog the intl provider received. */
  messages: unknown;
}

/** Writes the props the decorator gives the intl provider into the DOM, where a test reads them. */
function RecordingIntlProvider({ locale, messages, children }: StoryIntlProviderProps<Locale>) {
  return (
    <div data-testid="intl" data-locale={locale} data-messages={JSON.stringify(messages)}>
      {children}
    </div>
  );
}

const makePreview = () =>
  createStoryPreview<Locale>({
    IntlProvider: RecordingIntlProvider,
    routing: { locales: LOCALES, defaultLocale: "es" },
    // `ken.json` comes first and its name ends in "en.json": only a match on "/en.json" skips it.
    // `fr` has no catalog on purpose.
    catalogs: {
      "/apps/portal/messages/ken.json": KEN_MESSAGES,
      "/apps/portal/messages/en.json": EN_MESSAGES,
      "/apps/portal/messages/es.json": ES_MESSAGES,
    },
    defaultTheme: "dark",
  });

const renderStory = (globals: Record<string, unknown>): RenderedFrame => {
  const [decorate] = [makePreview().decorators].flat();
  if (decorate === undefined) throw new Error("the preview declares no decorator");
  // The decorator reads only the globals of the story's context.
  const context = { globals } as Parameters<typeof decorate>[1];
  const view = render(decorate(() => <span>story</span>, context));
  const frame = screen.getByText("story").closest("[data-theme]");
  const intl = screen.getByTestId("intl");
  const rendered: RenderedFrame = {
    themeClass: frame?.className,
    theme: frame?.getAttribute("data-theme") ?? null,
    locale: intl.dataset.locale,
    messages: JSON.parse(intl.dataset.messages ?? "null") as unknown,
  };
  view.unmount();
  return rendered;
};

describe("createStoryPreview", () => {
  describe("the decorator's theme", () => {
    it("wraps the story in the light theme's class when the theme global is light", () => {
      const frame = renderStory({ theme: "light", locale: "es" });

      expect(frame.themeClass).toBe("light");
      expect(frame.theme).toBe("light");
    });

    it("wraps the story in the portal's default theme when the theme global is not a theme", () => {
      const frame = renderStory({ theme: "sepia", locale: "es" });

      expect(frame.themeClass).toBe("dark");
      expect(frame.theme).toBe("dark");
    });
  });

  describe("the decorator's locale", () => {
    it("hands the provider the locale and the catalog whose file name ends in it when the locale is declared", () => {
      const frame = renderStory({ theme: "dark", locale: "en" });

      expect(frame.locale).toBe("en");
      expect(frame.messages).toEqual(EN_MESSAGES);
    });

    it("hands the provider the routing's default locale and its catalog when the locale is not declared", () => {
      const frame = renderStory({ theme: "dark", locale: "de" });

      expect(frame.locale).toBe("es");
      expect(frame.messages).toEqual(ES_MESSAGES);
    });

    it("hands the provider an empty catalog when the declared locale has none", () => {
      const frame = renderStory({ theme: "dark", locale: "fr" });

      expect(frame.locale).toBe("fr");
      expect(frame.messages).toEqual({});
    });
  });

  it("starts every story in the portal's default theme and the routing's default locale", () => {
    expect(makePreview().initialGlobals).toEqual({ theme: "dark", locale: "es" });
  });

  describe("the toolbars", () => {
    it("offers every locale of the routing, each named in its own language", () => {
      expect(makePreview().globalTypes.locale?.toolbar?.items).toEqual([
        { value: "en", title: "English" },
        { value: "es", title: "Español" },
        { value: "fr", title: "Français" },
      ]);
    });

    it("offers exactly the themes the decorator renders in, each with its label and icon", () => {
      const items = makePreview().globalTypes.theme?.toolbar?.items ?? [];
      const offered = items.map((item) => (typeof item === "string" ? item : item.value));

      expect(items).toEqual([
        { value: "light", title: "Light", icon: "sun" },
        { value: "dark", title: "Dark", icon: "moon" },
      ]);
      expect(offered.map((theme) => renderStory({ theme, locale: "es" }).theme)).toEqual(offered);
    });
  });
});

describe("tokenColor", () => {
  const renderScope = (): HTMLElement => {
    render(
      <div data-testid="scope">
        <span style={{ color: "rgb(0, 0, 255)" }}>label</span>
      </div>
    );
    screen.getByTestId("scope").style.setProperty("--error", "rgb(200, 0, 0)");
    return screen.getByText("label");
  };

  it("returns the colour a token resolves to where the element renders, not the element's own", () => {
    const label = renderScope();

    expect(tokenColor(label, "--error")).toBe("rgb(200, 0, 0)");
  });

  it("leaves the element's content as it found it after reading the token", () => {
    const label = renderScope();

    tokenColor(label, "--error");

    expect(label.childNodes).toHaveLength(1);
    expect(label.textContent).toBe("label");
  });

  it("throws naming the token when the token is not defined where the element renders", () => {
    const label = renderScope();

    expect(() => tokenColor(label, "--missing")).toThrow(
      "The token --missing is not defined where the element renders"
    );
  });
});
