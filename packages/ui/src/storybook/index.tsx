/**
 * @file index.tsx
 * @description The Storybook preview both portals share: control matchers, viewports, the
 *              accessibility check that fails a story over WCAG 2.1 A/AA, the theme and locale
 *              toolbars, and the decorator that renders a story inside the portal's intl provider
 *              and theme. A portal's preview passes what is its own — its provider, its locales,
 *              its message catalogs and its default theme — and adds its styles and anything else
 *              only it needs.
 * @layer infrastructure
 */
import type { Preview } from "@storybook/react";
import type { ComponentType, ReactNode } from "react";

/** The themes a story renders in: each is the class a portal's stylesheet scopes its tokens to. */
const STORY_THEMES = ["light", "dark"] as const;

/** A theme a story renders in. */
export type StoryTheme = (typeof STORY_THEMES)[number];

/** How the theme toolbar labels a theme. */
interface ThemeToolbarLabel {
  /** The item's text in the toolbar. */
  title: string;
  /** The Storybook icon beside it. */
  icon: string;
}

/**
 * Keyed by the theme type, so a theme added to the list without its label does not compile. Each
 * icon keeps its literal type, the only form Storybook's toolbar accepts as an icon name.
 */
const THEME_TOOLBAR_LABELS = {
  light: { title: "Light", icon: "sun" },
  dark: { title: "Dark", icon: "moon" },
} as const satisfies Readonly<Record<StoryTheme, ThemeToolbarLabel>>;

/** A message catalog, the shape next-intl reads, restated so this module needs no next-intl. */
export interface StoryMessages {
  [key: string]: StoryMessages | string;
}

/** The props the decorator renders the portal's intl provider with. */
export interface StoryIntlProviderProps<TLocale extends string> {
  /** The locale the story's toolbar selects. */
  locale: TLocale;
  /** That locale's catalog, or an empty one when the portal has none for it. */
  messages: StoryMessages;
  /** The framed story. */
  children: ReactNode;
}

/** The part of a portal's next-intl routing the preview reads. */
export interface StoryRouting<TLocale extends string> {
  /** The locales the routing declares; the locale toolbar offers each. */
  locales: readonly TLocale[];
  /** The locale a story renders in until the toolbar selects another. */
  defaultLocale: TLocale;
}

/** What a portal passes to build its preview. */
export interface StoryPreviewOptions<TLocale extends string> {
  /** The portal's intl provider, so a component that calls useTranslations renders its text. */
  IntlProvider: ComponentType<StoryIntlProviderProps<TLocale>>;
  /** The portal's routing, whose locales and default locale the toolbar and decorator use. */
  routing: StoryRouting<TLocale>;
  /** The portal's catalogs keyed by file path, each file named `<locale>.json`. */
  catalogs: Readonly<Record<string, StoryMessages>>;
  /** The theme a story renders in until the toolbar selects another: the portal's own default. */
  defaultTheme: StoryTheme;
}

/** The parts of a preview that every portal shares. */
type SharedPreview = Required<
  Pick<Preview, "parameters" | "initialGlobals" | "globalTypes" | "decorators">
>;

const isStoryTheme = (value: unknown): value is StoryTheme =>
  STORY_THEMES.some((theme) => theme === value);

/** The locale's name in its own language, first letter capitalised as a toolbar label. */
const nativeLanguageLabel = (locale: string): string => {
  // The default "code" fallback returns the code itself; the `??` only satisfies the type.
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  return name.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase(locale));
};

/**
 * The colour of the wrapper `tokenColor` reads a token in. A token that yields no colour leaves
 * the probe inside on this colour, never on the element's own, so the refusal can tell them apart.
 */
const TOKEN_PROBE_SENTINEL = "rgb(1, 2, 3)";

/**
 * @description The colour a CSS custom property resolves to where an element renders, as the
 *              browser computes it, so a story asserts that an element is drawn in a token's
 *              colour without restating the token's value. The returned colour is always one
 *              the token itself yields, never one the probe inherited, so a comparison with the
 *              element cannot pass by itself: the token is read on a probe inside a wrapper drawn
 *              in a sentinel colour, and a token that is not defined there, or whose value is no
 *              colour (invalid at computed-value time, so the probe inherits the wrapper's
 *              colour), is an error. The sentinel's limit: a token whose value is the sentinel,
 *              `rgb(1, 2, 3)`, or `currentcolor`, which takes the wrapper's colour, is refused
 *              too. Whatever was appended to the element is removed before the function returns
 *              or throws.
 * @param element - The element whose theme scope resolves the token
 * @param token - The custom property's name, such as `--error`
 * @returns The computed colour, in the form `getComputedStyle` reports a colour
 */
export function tokenColor(element: HTMLElement, token: string): string {
  if (getComputedStyle(element).getPropertyValue(token).trim() === "") {
    throw new Error(`The token ${token} is not defined where the element renders`);
  }
  const wrapper = document.createElement("span");
  wrapper.style.color = TOKEN_PROBE_SENTINEL;
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  wrapper.append(probe);
  element.append(wrapper);
  try {
    const color = getComputedStyle(probe).color;
    if (color === getComputedStyle(wrapper).color) {
      throw new Error(`The token ${token} does not hold a colour where the element renders`);
    }
    return color;
  } finally {
    wrapper.remove();
  }
}

/**
 * @description Builds the preview annotations a portal shares with the others: parameters,
 *              toolbars, initial globals and the decorator. The accessibility check runs at
 *              `error`, so any axe violation over WCAG 2.1 A/AA fails the story's test; the
 *              addon's default, `todo`, would only report it.
 * @param options - The portal's provider, routing, catalogs and default theme
 * @returns The parameters, initialGlobals, globalTypes and decorators of the portal's preview
 */
export function createStoryPreview<TLocale extends string>(
  options: StoryPreviewOptions<TLocale>
): SharedPreview {
  const { IntlProvider, routing, catalogs, defaultTheme } = options;
  const { locales, defaultLocale } = routing;

  const isStoryLocale = (value: unknown): value is TLocale =>
    locales.some((locale) => locale === value);

  const messagesOf = (locale: TLocale): StoryMessages =>
    Object.entries(catalogs).find(([file]) => file.endsWith(`/${locale}.json`))?.[1] ?? {};

  return {
    parameters: {
      nextjs: {
        appDirectory: true,
      },
      controls: {
        matchers: {
          color: /(background|color)$/i,
          date: /Date$/i,
        },
      },
      viewport: {
        options: {
          mobile: { name: "Mobile", styles: { width: "375px", height: "667px" } },
          tablet: { name: "Tablet", styles: { width: "768px", height: "1024px" } },
          desktop: { name: "Desktop", styles: { width: "1440px", height: "900px" } },
          widescreen: { name: "Widescreen", styles: { width: "1920px", height: "1080px" } },
        },
      },
      a11y: {
        test: "error",
        options: {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
          checks: { "color-contrast": { options: { noScroll: true } } },
          restoreScroll: true,
        },
      },
    },
    initialGlobals: {
      theme: defaultTheme,
      locale: defaultLocale,
    },
    globalTypes: {
      theme: {
        description: "Global theme for components",
        toolbar: {
          title: "Theme",
          icon: "paintbrush",
          items: STORY_THEMES.map((value) => ({ value, ...THEME_TOOLBAR_LABELS[value] })),
          dynamicTitle: true,
        },
      },
      locale: {
        description: "Locale of the messages the components read",
        toolbar: {
          title: "Locale",
          icon: "globe",
          items: locales.map((value) => ({ value, title: nativeLanguageLabel(value) })),
          dynamicTitle: true,
        },
      },
    },
    decorators: [
      (Story, context) => {
        const requestedTheme: unknown = context.globals.theme;
        const requestedLocale: unknown = context.globals.locale;
        const theme = isStoryTheme(requestedTheme) ? requestedTheme : defaultTheme;
        const locale = isStoryLocale(requestedLocale) ? requestedLocale : defaultLocale;

        return (
          <IntlProvider locale={locale} messages={messagesOf(locale)}>
            <div className={theme} data-theme={theme}>
              <div className="min-h-screen bg-background text-foreground p-4">
                <Story />
              </div>
            </div>
          </IntlProvider>
        );
      },
    ],
  };
}
