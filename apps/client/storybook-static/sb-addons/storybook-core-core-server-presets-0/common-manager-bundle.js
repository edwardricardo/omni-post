try {
  (() => {
    var S = __STORYBOOK_API__,
      {
        ActiveTabs: k,
        Consumer: O,
        ManagerContext: T,
        Provider: v,
        RequestResponseError: P,
        addons: l,
        combineParameters: g,
        controlOrMetaKey: w,
        controlOrMetaSymbol: A,
        eventMatchesShortcut: j,
        eventToShortcut: x,
        experimental_MockUniversalStore: R,
        experimental_UniversalStore: U,
        experimental_requestResponse: C,
        experimental_useUniversalStore: I,
        isMacLike: L,
        isShortcutTaken: M,
        keyToSymbol: B,
        merge: E,
        mockChannel: N,
        optionOrAltSymbol: K,
        shortcutMatchesShortcut: G,
        shortcutToHumanString: Y,
        types: q,
        useAddonState: D,
        useArgTypes: F,
        useArgs: H,
        useChannel: X,
        useGlobalTypes: V,
        useGlobals: z,
        useParameter: J,
        useSharedState: Q,
        useStoryPrepared: W,
        useStorybookApi: Z,
        useStorybookState: $,
      } = __STORYBOOK_API__;
    var n = (() => {
        let e;
        return (
          typeof window < "u"
            ? (e = window)
            : typeof globalThis < "u"
              ? (e = globalThis)
              : typeof window < "u"
                ? (e = window)
                : typeof self < "u"
                  ? (e = self)
                  : (e = {}),
          e
        );
      })(),
      _ = "tag-filters",
      m = "static-filter";
    l.register(_, (e) => {
      let u = Object.entries(n.TAGS_OPTIONS ?? {}).reduce((o, t) => {
        let [r, p] = t;
        return (p.excludeFromSidebar && (o[r] = !0), o);
      }, {});
      e.experimental_setFilter(m, (o) => {
        let t = o.tags ?? [];
        return (t.includes("dev") || o.type === "docs") && t.filter((r) => u[r]).length === 0;
      });
    });
  })();
} catch (e) {
  console.error("[Storybook] One of your manager-entries failed: " + import.meta.url, e);
}
