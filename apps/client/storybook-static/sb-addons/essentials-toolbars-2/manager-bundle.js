try {
  (() => {
    var l = __REACT__,
      {
        Children: se,
        Component: ue,
        Fragment: ie,
        Profiler: de,
        PureComponent: pe,
        StrictMode: ce,
        Suspense: me,
        __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: _e,
        cloneElement: be,
        createContext: ye,
        createElement: Se,
        createFactory: fe,
        createRef: Te,
        forwardRef: ve,
        isValidElement: Ce,
        lazy: Ie,
        memo: Oe,
        startTransition: Ee,
        unstable_act: he,
        useCallback: v,
        useContext: ke,
        useDebugValue: xe,
        useDeferredValue: ge,
        useEffect: k,
        useId: Ae,
        useImperativeHandle: Re,
        useInsertionEffect: Le,
        useLayoutEffect: Pe,
        useMemo: Be,
        useReducer: we,
        useRef: L,
        useState: P,
        useSyncExternalStore: Ne,
        useTransition: Me,
        version: De,
      } = __REACT__;
    var We = __STORYBOOK_API__,
      {
        ActiveTabs: Fe,
        Consumer: Ge,
        ManagerContext: Ke,
        Provider: Ye,
        RequestResponseError: $e,
        addons: x,
        combineParameters: qe,
        controlOrMetaKey: ze,
        controlOrMetaSymbol: Xe,
        eventMatchesShortcut: Ze,
        eventToShortcut: Je,
        experimental_MockUniversalStore: Qe,
        experimental_UniversalStore: et,
        experimental_requestResponse: tt,
        experimental_useUniversalStore: ot,
        isMacLike: rt,
        isShortcutTaken: at,
        keyToSymbol: lt,
        merge: nt,
        mockChannel: st,
        optionOrAltSymbol: ut,
        shortcutMatchesShortcut: it,
        shortcutToHumanString: dt,
        types: B,
        useAddonState: pt,
        useArgTypes: ct,
        useArgs: mt,
        useChannel: _t,
        useGlobalTypes: w,
        useGlobals: g,
        useParameter: bt,
        useSharedState: yt,
        useStoryPrepared: St,
        useStorybookApi: N,
        useStorybookState: ft,
      } = __STORYBOOK_API__;
    var Ot = __STORYBOOK_COMPONENTS__,
      {
        A: Et,
        ActionBar: ht,
        AddonPanel: kt,
        Badge: xt,
        Bar: gt,
        Blockquote: At,
        Button: Rt,
        ClipboardCode: Lt,
        Code: Pt,
        DL: Bt,
        Div: wt,
        DocumentWrapper: Nt,
        EmptyTabContent: Mt,
        ErrorFormatter: Dt,
        FlexBar: Vt,
        Form: Ht,
        H1: Ut,
        H2: jt,
        H3: Wt,
        H4: Ft,
        H5: Gt,
        H6: Kt,
        HR: Yt,
        IconButton: M,
        IconButtonSkeleton: $t,
        Icons: A,
        Img: qt,
        LI: zt,
        Link: Xt,
        ListItem: Zt,
        Loader: Jt,
        Modal: Qt,
        OL: eo,
        P: to,
        Placeholder: oo,
        Pre: ro,
        ProgressSpinner: ao,
        ResetWrapper: lo,
        ScrollArea: no,
        Separator: D,
        Spaced: so,
        Span: uo,
        StorybookIcon: io,
        StorybookLogo: po,
        Symbols: co,
        SyntaxHighlighter: mo,
        TT: _o,
        TabBar: bo,
        TabButton: yo,
        TabWrapper: So,
        Table: fo,
        Tabs: To,
        TabsState: vo,
        TooltipLinkList: V,
        TooltipMessage: Co,
        TooltipNote: Io,
        UL: Oo,
        WithTooltip: H,
        WithTooltipPure: Eo,
        Zoom: ho,
        codeCommon: ko,
        components: xo,
        createCopyToClipboardFunction: go,
        getStoryHref: Ao,
        icons: Ro,
        interleaveSeparators: Lo,
        nameSpaceClassNames: Po,
        resetComponents: Bo,
        withReset: wo,
      } = __STORYBOOK_COMPONENTS__;
    var F = { type: "item", value: "" },
      G = (o, t) => ({
        ...t,
        name: t.name || o,
        description: t.description || o,
        toolbar: {
          ...t.toolbar,
          items: t.toolbar.items.map((e) => {
            let r = typeof e == "string" ? { value: e, title: e } : e;
            return (
              r.type === "reset" &&
                t.toolbar.icon &&
                ((r.icon = t.toolbar.icon), (r.hideIcon = !0)),
              { ...F, ...r }
            );
          }),
        },
      }),
      K = ["reset"],
      Y = (o) => o.filter((t) => !K.includes(t.type)).map((t) => t.value),
      b = "addon-toolbars",
      $ = async (o, t, e) => {
        (e &&
          e.next &&
          (await o.setAddonShortcut(b, {
            label: e.next.label,
            defaultShortcut: e.next.keys,
            actionName: `${t}:next`,
            action: e.next.action,
          })),
          e &&
            e.previous &&
            (await o.setAddonShortcut(b, {
              label: e.previous.label,
              defaultShortcut: e.previous.keys,
              actionName: `${t}:previous`,
              action: e.previous.action,
            })),
          e &&
            e.reset &&
            (await o.setAddonShortcut(b, {
              label: e.reset.label,
              defaultShortcut: e.reset.keys,
              actionName: `${t}:reset`,
              action: e.reset.action,
            })));
      },
      q = (o) => (t) => {
        let {
            id: e,
            toolbar: { items: r, shortcuts: a },
          } = t,
          d = N(),
          [y, u] = g(),
          n = L([]),
          i = y[e],
          C = v(() => {
            u({ [e]: "" });
          }, [u]),
          I = v(() => {
            let s = n.current,
              c = s.indexOf(i),
              m = c === s.length - 1 ? 0 : c + 1,
              p = n.current[m];
            u({ [e]: p });
          }, [n, i, u]),
          O = v(() => {
            let s = n.current,
              c = s.indexOf(i),
              m = c > -1 ? c : 0,
              p = m === 0 ? s.length - 1 : m - 1,
              _ = n.current[p];
            u({ [e]: _ });
          }, [n, i, u]);
        return (
          k(() => {
            a &&
              $(d, e, {
                next: { ...a.next, action: I },
                previous: { ...a.previous, action: O },
                reset: { ...a.reset, action: C },
              });
          }, [d, e, a, I, O, C]),
          k(() => {
            n.current = Y(r);
          }, []),
          l.createElement(o, { cycleValues: n.current, ...t })
        );
      },
      U = ({ currentValue: o, items: t }) =>
        o != null && t.find((e) => e.value === o && e.type !== "reset"),
      z = ({ currentValue: o, items: t }) => {
        let e = U({ currentValue: o, items: t });
        if (e) return e.icon;
      },
      X = ({ currentValue: o, items: t }) => {
        let e = U({ currentValue: o, items: t });
        if (e) return e.title;
      },
      Z = ({ active: o, disabled: t, title: e, icon: r, description: a, onClick: d }) =>
        l.createElement(
          M,
          { active: o, title: a, disabled: t, onClick: t ? () => {} : d },
          r && l.createElement(A, { icon: r, __suppressDeprecationWarning: !0 }),
          e ? `\xA0${e}` : null
        ),
      J = ({
        right: o,
        title: t,
        value: e,
        icon: r,
        hideIcon: a,
        onClick: d,
        disabled: y,
        currentValue: u,
      }) => {
        let n =
            r &&
            l.createElement(A, {
              style: { opacity: 1 },
              icon: r,
              __suppressDeprecationWarning: !0,
            }),
          i = { id: e ?? "_reset", active: u === e, right: o, title: t, disabled: y, onClick: d };
        return (r && !a && (i.icon = n), i);
      },
      Q = q(
        ({
          id: o,
          name: t,
          description: e,
          toolbar: { icon: r, items: a, title: d, preventDynamicIcon: y, dynamicTitle: u },
        }) => {
          let [n, i, C] = g(),
            [I, O] = P(!1),
            s = n[o],
            c = !!s,
            m = o in C,
            p = r,
            _ = d;
          (y || (p = z({ currentValue: s, items: a }) || p),
            u && (_ = X({ currentValue: s, items: a }) || _),
            !_ && !p && console.warn(`Toolbar '${t}' has no title or icon`));
          let j = v(
            (h) => {
              i({ [o]: h });
            },
            [o, i]
          );
          return l.createElement(
            H,
            {
              placement: "top",
              tooltip: ({ onHide: h }) => {
                let W = a
                  .filter(({ type: E }) => {
                    let R = !0;
                    return (E === "reset" && !s && (R = !1), R);
                  })
                  .map((E) =>
                    J({
                      ...E,
                      currentValue: s,
                      disabled: m,
                      onClick: () => {
                        (j(E.value), h());
                      },
                    })
                  );
                return l.createElement(V, { links: W });
              },
              closeOnOutsideClick: !0,
              onVisibleChange: O,
            },
            l.createElement(Z, {
              active: I || c,
              disabled: m,
              description: e || "",
              icon: p,
              title: _ || "",
            })
          );
        }
      ),
      ee = () => {
        let o = w(),
          t = Object.keys(o).filter((e) => !!o[e].toolbar);
        return t.length
          ? l.createElement(
              l.Fragment,
              null,
              l.createElement(D, null),
              t.map((e) => {
                let r = G(e, o[e]);
                return l.createElement(Q, { key: e, id: e, ...r });
              })
            )
          : null;
      };
    x.register(b, () =>
      x.add(b, {
        title: b,
        type: B.TOOL,
        match: ({ tabId: o }) => !o,
        render: () => l.createElement(ee, null),
      })
    );
  })();
} catch (e) {
  console.error("[Storybook] One of your manager-entries failed: " + import.meta.url, e);
}
