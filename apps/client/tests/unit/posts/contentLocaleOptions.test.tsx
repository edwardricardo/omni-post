/**
 * @file contentLocaleOptions.test.tsx
 * @description The composer's content languages come from CONTENT_LOCALES: the new-post and
 *              edit-post pages offer exactly those languages, each named by the interface catalog
 *              (or by Intl.DisplayNames for a language the catalog does not name), the edit page
 *              hands its editor the language the user selected, and the preview names the post's
 *              language. The Select primitive is replaced by plain options so the offer is
 *              readable without opening a Radix popover.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { CONTENT_LOCALES } from "@shared/types";
import NewPostPage from "@/app/[locale]/dashboard/posts/new/page";
import EditPostPage from "@/app/[locale]/dashboard/posts/[id]/page";
import PreviewPostPage from "@/app/[locale]/dashboard/posts/[id]/preview/page";
import { contentLocaleLabel } from "@/app/[locale]/dashboard/posts/useContentLocaleOptions";
import type { Post } from "@/lib/api/types";
import { renderInLocale, TEST_CATALOGS, type TestLocale } from "../../intl-test-utils";

const { editorLocales, postState } = vi.hoisted(() => ({
  editorLocales: [] as Array<string | undefined>,
  postState: { post: undefined as unknown },
}));

vi.mock("@packages/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@packages/ui")>();
  const React = await import("react");
  type Children = { children?: React.ReactNode };
  const Choose = React.createContext<(value: string) => void>(() => undefined);
  return {
    ...actual,
    Select: ({
      value,
      onValueChange,
      children,
    }: Children & { value?: string; onValueChange?: (value: string) => void }) =>
      React.createElement(
        Choose.Provider,
        { value: onValueChange ?? (() => undefined) },
        React.createElement("div", { role: "listbox", "data-value": value }, children)
      ),
    SelectTrigger: ({ children }: Children) => React.createElement(React.Fragment, null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: Children) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: Children & { value: string }) => {
      const choose = React.useContext(Choose);
      return React.createElement(
        "button",
        { type: "button", role: "option", "data-value": value, onClick: () => choose(value) },
        children
      );
    },
  };
});

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "post-1" }) }));
vi.mock("@/lib/api/hooks", () => ({
  useProjects: () => ({ data: { data: [] } }),
  usePost: () => ({
    data: { data: postState.post },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks/useProviders", () => ({
  useProviders: () => ({ providers: [], enabledProviders: [], getProviderConfig: () => undefined }),
}));
vi.mock("@/lib/hooks/useProjectChannels", () => ({ useProjectChannels: () => ({ data: [] }) }));
vi.mock("@/lib/hooks/useSchedulePostViaSaga", () => ({
  useSchedulePostViaSaga: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/auth/authContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/lib/api/client", () => ({ apiClient: {} }));
vi.mock("@/lib/api/clients/sagaClient", () => ({ runSagaAndAwaitTerminal: vi.fn() }));
vi.mock("@/components/editor/PlatformPreview", () => ({ PlatformPreview: () => null }));
vi.mock("@/components/editor/ClientContentEditor", () => ({
  ClientContentEditor: (props: { locale?: string }) => {
    editorLocales.push(props.locale);
    return null;
  },
}));

const UI_LOCALES: TestLocale[] = ["es", "en"];

/**
 * @description A post as GET /posts/:id returns it, written in the given language.
 * @param locale - The post's content language.
 * @returns The post.
 */
function makePost(locale: Post["locale"]): Post {
  return {
    id: "post-1",
    projectId: "proj-1",
    locale,
    title: "Launch",
    body: "Hola",
    tags: [],
    status: "DRAFT",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
  };
}

/**
 * @description The options of the language select, as value and visible name.
 * @returns One entry per option, in order.
 */
function offeredLanguages(): Array<{ value: string | null; name: string | null }> {
  const select = screen
    .getAllByRole("listbox")
    .find((listbox) => within(listbox).queryAllByRole("option").length > 0);
  if (!select) throw new Error("no language select rendered");
  return within(select)
    .getAllByRole("option")
    .map((option) => ({ value: option.getAttribute("data-value"), name: option.textContent }));
}

/**
 * @description What the composer should offer in an interface language: every content locale,
 *   named by that language's catalog.
 * @param uiLocale - The interface language.
 * @returns One entry per content locale, in CONTENT_LOCALES order.
 */
function expectedOffer(uiLocale: TestLocale) {
  return CONTENT_LOCALES.map((value) => ({
    value,
    name: TEST_CATALOGS[uiLocale].posts.language[value],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  editorLocales.length = 0;
  postState.post = undefined;
});

describe("contentLocaleLabel", () => {
  it("names a language with the catalog's message when the catalog has one", () => {
    expect(contentLocaleLabel("es", { es: "Español" }, "en")).toBe("Español");
  });

  it("names a language the catalog lacks with its Intl.DisplayNames name in the interface language", () => {
    expect(contentLocaleLabel("pt", { es: "Español" }, "es")).toBe("portugués");
    expect(contentLocaleLabel("pt", { es: "Español" }, "en")).toBe("Portuguese");
  });
});

describe("the post composer's language select", () => {
  it.each(UI_LOCALES)("the new-post page offers exactly the content locales, named in %s", (ui) => {
    renderInLocale(ui, <NewPostPage />);

    expect(offeredLanguages()).toEqual(expectedOffer(ui));
  });

  it.each(UI_LOCALES)("the edit page offers exactly the content locales, named in %s", (ui) => {
    postState.post = makePost("es");

    renderInLocale(ui, <EditPostPage />);

    expect(offeredLanguages()).toEqual(expectedOffer(ui));
  });

  it("the edit page starts on the post's language and hands its editor the language the user selects", () => {
    postState.post = makePost("es");
    renderInLocale("en", <EditPostPage />);
    expect(editorLocales.at(-1)).toBe("es");

    fireEvent.click(screen.getByRole("option", { name: "English" }));

    expect(editorLocales.at(-1)).toBe("en");
  });
});

describe("the post preview's language", () => {
  it.each(UI_LOCALES.flatMap((ui) => CONTENT_LOCALES.map((locale) => [ui, locale] as const)))(
    "in %s, names a post written in %s with the catalog's name",
    (ui, locale) => {
      postState.post = makePost(locale);

      renderInLocale(ui, <PreviewPostPage />);

      const heading = screen.getByRole("heading", {
        name: TEST_CATALOGS[ui].posts.fields.language,
      });
      expect(heading.nextElementSibling?.textContent).toBe(
        TEST_CATALOGS[ui].posts.language[locale]
      );
    }
  );
});
