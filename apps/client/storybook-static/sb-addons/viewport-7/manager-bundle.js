try {
  (() => {
    var me = Object.create;
    var $ = Object.defineProperty;
    var he = Object.getOwnPropertyDescriptor;
    var fe = Object.getOwnPropertyNames;
    var ge = Object.getPrototypeOf,
      be = Object.prototype.hasOwnProperty;
    var x = ((e) =>
      typeof require < "u"
        ? require
        : typeof Proxy < "u"
          ? new Proxy(e, { get: (t, a) => (typeof require < "u" ? require : t)[a] })
          : e)(function (e) {
      if (typeof require < "u") return require.apply(this, arguments);
      throw Error('Dynamic require of "' + e + '" is not supported');
    });
    var N = (e, t) => () => (e && (t = e((e = 0))), t);
    var ye = (e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports);
    var we = (e, t, a, s) => {
      if ((t && typeof t == "object") || typeof t == "function")
        for (let l of fe(t))
          !be.call(e, l) &&
            l !== a &&
            $(e, l, { get: () => t[l], enumerable: !(s = he(t, l)) || s.enumerable });
      return e;
    };
    var Se = (e, t, a) => (
      (a = e != null ? me(ge(e)) : {}),
      we(t || !e || !e.__esModule ? $(a, "default", { value: e, enumerable: !0 }) : a, e)
    );
    var f = N(() => {});
    var g = N(() => {});
    var b = N(() => {});
    var ce = ye((le, Z) => {
      f();
      g();
      b();
      (function (e) {
        if (typeof le == "object" && typeof Z < "u") Z.exports = e();
        else if (typeof define == "function" && define.amd) define([], e);
        else {
          var t;
          (typeof window < "u" || typeof window < "u"
            ? (t = window)
            : typeof self < "u"
              ? (t = self)
              : (t = this),
            (t.memoizerific = e()));
        }
      })(function () {
        var e, t, a;
        return (function s(l, y, d) {
          function o(n, I) {
            if (!y[n]) {
              if (!l[n]) {
                var r = typeof x == "function" && x;
                if (!I && r) return r(n, !0);
                if (i) return i(n, !0);
                var u = new Error("Cannot find module '" + n + "'");
                throw ((u.code = "MODULE_NOT_FOUND"), u);
              }
              var p = (y[n] = { exports: {} });
              l[n][0].call(
                p.exports,
                function (h) {
                  var w = l[n][1][h];
                  return o(w || h);
                },
                p,
                p.exports,
                s,
                l,
                y,
                d
              );
            }
            return y[n].exports;
          }
          for (var i = typeof x == "function" && x, m = 0; m < d.length; m++) o(d[m]);
          return o;
        })(
          {
            1: [
              function (s, l, y) {
                l.exports = function (d) {
                  if (typeof Map != "function" || d) {
                    var o = s("./similar");
                    return new o();
                  } else return new Map();
                };
              },
              { "./similar": 2 },
            ],
            2: [
              function (s, l, y) {
                function d() {
                  return ((this.list = []), (this.lastItem = void 0), (this.size = 0), this);
                }
                ((d.prototype.get = function (o) {
                  var i;
                  if (this.lastItem && this.isEqual(this.lastItem.key, o)) return this.lastItem.val;
                  if (((i = this.indexOf(o)), i >= 0))
                    return ((this.lastItem = this.list[i]), this.list[i].val);
                }),
                  (d.prototype.set = function (o, i) {
                    var m;
                    return this.lastItem && this.isEqual(this.lastItem.key, o)
                      ? ((this.lastItem.val = i), this)
                      : ((m = this.indexOf(o)),
                        m >= 0
                          ? ((this.lastItem = this.list[m]), (this.list[m].val = i), this)
                          : ((this.lastItem = { key: o, val: i }),
                            this.list.push(this.lastItem),
                            this.size++,
                            this));
                  }),
                  (d.prototype.delete = function (o) {
                    var i;
                    if (
                      (this.lastItem &&
                        this.isEqual(this.lastItem.key, o) &&
                        (this.lastItem = void 0),
                      (i = this.indexOf(o)),
                      i >= 0)
                    )
                      return (this.size--, this.list.splice(i, 1)[0]);
                  }),
                  (d.prototype.has = function (o) {
                    var i;
                    return this.lastItem && this.isEqual(this.lastItem.key, o)
                      ? !0
                      : ((i = this.indexOf(o)), i >= 0 ? ((this.lastItem = this.list[i]), !0) : !1);
                  }),
                  (d.prototype.forEach = function (o, i) {
                    var m;
                    for (m = 0; m < this.size; m++)
                      o.call(i || this, this.list[m].val, this.list[m].key, this);
                  }),
                  (d.prototype.indexOf = function (o) {
                    var i;
                    for (i = 0; i < this.size; i++) if (this.isEqual(this.list[i].key, o)) return i;
                    return -1;
                  }),
                  (d.prototype.isEqual = function (o, i) {
                    return o === i || (o !== o && i !== i);
                  }),
                  (l.exports = d));
              },
              {},
            ],
            3: [
              function (s, l, y) {
                var d = s("map-or-similar");
                l.exports = function (n) {
                  var I = new d(!1),
                    r = [];
                  return function (u) {
                    var p = function () {
                      var h = I,
                        w,
                        T,
                        S = arguments.length - 1,
                        M = Array(S + 1),
                        R = !0,
                        _;
                      if ((p.numArgs || p.numArgs === 0) && p.numArgs !== S + 1)
                        throw new Error(
                          "Memoizerific functions should always be called with the same number of arguments"
                        );
                      for (_ = 0; _ < S; _++) {
                        if (((M[_] = { cacheItem: h, arg: arguments[_] }), h.has(arguments[_]))) {
                          h = h.get(arguments[_]);
                          continue;
                        }
                        ((R = !1), (w = new d(!1)), h.set(arguments[_], w), (h = w));
                      }
                      return (
                        R && (h.has(arguments[S]) ? (T = h.get(arguments[S])) : (R = !1)),
                        R || ((T = u.apply(null, arguments)), h.set(arguments[S], T)),
                        n > 0 &&
                          ((M[S] = { cacheItem: h, arg: arguments[S] }),
                          R ? o(r, M) : r.push(M),
                          r.length > n && i(r.shift())),
                        (p.wasMemoized = R),
                        (p.numArgs = S + 1),
                        T
                      );
                    };
                    return ((p.limit = n), (p.wasMemoized = !1), (p.cache = I), (p.lru = r), p);
                  };
                };
                function o(n, I) {
                  var r = n.length,
                    u = I.length,
                    p,
                    h,
                    w;
                  for (h = 0; h < r; h++) {
                    for (p = !0, w = 0; w < u; w++)
                      if (!m(n[h][w].arg, I[w].arg)) {
                        p = !1;
                        break;
                      }
                    if (p) break;
                  }
                  n.push(n.splice(h, 1)[0]);
                }
                function i(n) {
                  var I = n.length,
                    r = n[I - 1],
                    u,
                    p;
                  for (
                    r.cacheItem.delete(r.arg), p = I - 2;
                    p >= 0 && ((r = n[p]), (u = r.cacheItem.get(r.arg)), !u || !u.size);
                    p--
                  )
                    r.cacheItem.delete(r.arg);
                }
                function m(n, I) {
                  return n === I || (n !== n && I !== I);
                }
              },
              { "map-or-similar": 1 },
            ],
          },
          {},
          [3]
        )(3);
      });
    });
    f();
    g();
    b();
    f();
    g();
    b();
    f();
    g();
    b();
    var c = __REACT__,
      {
        Children: Xe,
        Component: $e,
        Fragment: V,
        Profiler: Je,
        PureComponent: Qe,
        StrictMode: et,
        Suspense: tt,
        __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: ot,
        cloneElement: nt,
        createContext: rt,
        createElement: U,
        createFactory: it,
        createRef: at,
        forwardRef: lt,
        isValidElement: ct,
        lazy: st,
        memo: J,
        startTransition: ut,
        unstable_act: pt,
        useCallback: Q,
        useContext: dt,
        useDebugValue: It,
        useDeferredValue: mt,
        useEffect: O,
        useId: ht,
        useImperativeHandle: ft,
        useInsertionEffect: gt,
        useLayoutEffect: bt,
        useMemo: yt,
        useReducer: wt,
        useRef: ee,
        useState: z,
        useSyncExternalStore: St,
        useTransition: vt,
        version: _t,
      } = __REACT__;
    f();
    g();
    b();
    var Tt = __STORYBOOK_API__,
      {
        ActiveTabs: Rt,
        Consumer: At,
        ManagerContext: xt,
        Provider: Ot,
        RequestResponseError: Lt,
        addons: H,
        combineParameters: Pt,
        controlOrMetaKey: Bt,
        controlOrMetaSymbol: Mt,
        eventMatchesShortcut: Vt,
        eventToShortcut: Dt,
        experimental_MockUniversalStore: Nt,
        experimental_UniversalStore: Ut,
        experimental_requestResponse: zt,
        experimental_useUniversalStore: Ht,
        isMacLike: Gt,
        isShortcutTaken: Ft,
        keyToSymbol: qt,
        merge: Wt,
        mockChannel: jt,
        optionOrAltSymbol: Yt,
        shortcutMatchesShortcut: Kt,
        shortcutToHumanString: Zt,
        types: te,
        useAddonState: Xt,
        useArgTypes: $t,
        useArgs: Jt,
        useChannel: Qt,
        useGlobalTypes: eo,
        useGlobals: G,
        useParameter: F,
        useSharedState: to,
        useStoryPrepared: oo,
        useStorybookApi: oe,
        useStorybookState: no,
      } = __STORYBOOK_API__;
    f();
    g();
    b();
    var co = __STORYBOOK_COMPONENTS__,
      {
        A: so,
        ActionBar: uo,
        AddonPanel: po,
        Badge: Io,
        Bar: mo,
        Blockquote: ho,
        Button: fo,
        ClipboardCode: go,
        Code: bo,
        DL: yo,
        Div: wo,
        DocumentWrapper: So,
        EmptyTabContent: vo,
        ErrorFormatter: _o,
        FlexBar: Co,
        Form: ko,
        H1: Eo,
        H2: To,
        H3: Ro,
        H4: Ao,
        H5: xo,
        H6: Oo,
        HR: Lo,
        IconButton: L,
        IconButtonSkeleton: Po,
        Icons: Bo,
        Img: Mo,
        LI: Vo,
        Link: Do,
        ListItem: No,
        Loader: Uo,
        Modal: zo,
        OL: Ho,
        P: Go,
        Placeholder: Fo,
        Pre: qo,
        ProgressSpinner: Wo,
        ResetWrapper: jo,
        ScrollArea: Yo,
        Separator: Ko,
        Spaced: Zo,
        Span: Xo,
        StorybookIcon: $o,
        StorybookLogo: Jo,
        Symbols: Qo,
        SyntaxHighlighter: en,
        TT: tn,
        TabBar: on,
        TabButton: nn,
        TabWrapper: rn,
        Table: an,
        Tabs: ln,
        TabsState: cn,
        TooltipLinkList: q,
        TooltipMessage: sn,
        TooltipNote: un,
        UL: pn,
        WithTooltip: W,
        WithTooltipPure: dn,
        Zoom: In,
        codeCommon: mn,
        components: hn,
        createCopyToClipboardFunction: fn,
        getStoryHref: gn,
        icons: bn,
        interleaveSeparators: yn,
        nameSpaceClassNames: wn,
        resetComponents: Sn,
        withReset: vn,
      } = __STORYBOOK_COMPONENTS__;
    f();
    g();
    b();
    var Tn = __STORYBOOK_THEMING__,
      {
        CacheProvider: Rn,
        ClassNames: An,
        Global: j,
        ThemeProvider: xn,
        background: On,
        color: Ln,
        convert: Pn,
        create: Bn,
        createCache: Mn,
        createGlobal: Vn,
        createReset: Dn,
        css: Nn,
        darken: Un,
        ensure: zn,
        ignoreSsrWarning: Hn,
        isPropValid: Gn,
        jsx: Fn,
        keyframes: qn,
        lighten: Wn,
        styled: v,
        themes: jn,
        typography: Yn,
        useTheme: Kn,
        withTheme: Zn,
      } = __STORYBOOK_THEMING__;
    f();
    g();
    b();
    var er = __STORYBOOK_ICONS__,
      {
        AccessibilityAltIcon: tr,
        AccessibilityIcon: or,
        AccessibilityIgnoredIcon: nr,
        AddIcon: rr,
        AdminIcon: ir,
        AlertAltIcon: ar,
        AlertIcon: lr,
        AlignLeftIcon: cr,
        AlignRightIcon: sr,
        AppleIcon: ur,
        ArrowBottomLeftIcon: pr,
        ArrowBottomRightIcon: dr,
        ArrowDownIcon: Ir,
        ArrowLeftIcon: mr,
        ArrowRightIcon: hr,
        ArrowSolidDownIcon: fr,
        ArrowSolidLeftIcon: gr,
        ArrowSolidRightIcon: br,
        ArrowSolidUpIcon: yr,
        ArrowTopLeftIcon: wr,
        ArrowTopRightIcon: Sr,
        ArrowUpIcon: vr,
        AzureDevOpsIcon: _r,
        BackIcon: Cr,
        BasketIcon: kr,
        BatchAcceptIcon: Er,
        BatchDenyIcon: Tr,
        BeakerIcon: Rr,
        BellIcon: Ar,
        BitbucketIcon: xr,
        BoldIcon: Or,
        BookIcon: Lr,
        BookmarkHollowIcon: Pr,
        BookmarkIcon: Br,
        BottomBarIcon: Mr,
        BottomBarToggleIcon: Vr,
        BoxIcon: Dr,
        BranchIcon: Nr,
        BrowserIcon: ne,
        ButtonIcon: Ur,
        CPUIcon: zr,
        CalendarIcon: Hr,
        CameraIcon: Gr,
        CameraStabilizeIcon: Fr,
        CategoryIcon: qr,
        CertificateIcon: Wr,
        ChangedIcon: jr,
        ChatIcon: Yr,
        CheckIcon: Kr,
        ChevronDownIcon: Zr,
        ChevronLeftIcon: Xr,
        ChevronRightIcon: $r,
        ChevronSmallDownIcon: Jr,
        ChevronSmallLeftIcon: Qr,
        ChevronSmallRightIcon: ei,
        ChevronSmallUpIcon: ti,
        ChevronUpIcon: oi,
        ChromaticIcon: ni,
        ChromeIcon: ri,
        CircleHollowIcon: ii,
        CircleIcon: ai,
        ClearIcon: li,
        CloseAltIcon: ci,
        CloseIcon: si,
        CloudHollowIcon: ui,
        CloudIcon: pi,
        CogIcon: di,
        CollapseIcon: Ii,
        CommandIcon: mi,
        CommentAddIcon: hi,
        CommentIcon: fi,
        CommentsIcon: gi,
        CommitIcon: bi,
        CompassIcon: yi,
        ComponentDrivenIcon: wi,
        ComponentIcon: Si,
        ContrastIcon: vi,
        ContrastIgnoredIcon: _i,
        ControlsIcon: Ci,
        CopyIcon: ki,
        CreditIcon: Ei,
        CrossIcon: Ti,
        DashboardIcon: Ri,
        DatabaseIcon: Ai,
        DeleteIcon: xi,
        DiamondIcon: Oi,
        DirectionIcon: Li,
        DiscordIcon: Pi,
        DocChartIcon: Bi,
        DocListIcon: Mi,
        DocumentIcon: Vi,
        DownloadIcon: Di,
        DragIcon: Ni,
        EditIcon: Ui,
        EllipsisIcon: zi,
        EmailIcon: Hi,
        ExpandAltIcon: Gi,
        ExpandIcon: Fi,
        EyeCloseIcon: qi,
        EyeIcon: Wi,
        FaceHappyIcon: ji,
        FaceNeutralIcon: Yi,
        FaceSadIcon: Ki,
        FacebookIcon: Zi,
        FailedIcon: Xi,
        FastForwardIcon: $i,
        FigmaIcon: Ji,
        FilterIcon: Qi,
        FlagIcon: ea,
        FolderIcon: ta,
        FormIcon: oa,
        GDriveIcon: na,
        GithubIcon: ra,
        GitlabIcon: ia,
        GlobeIcon: aa,
        GoogleIcon: la,
        GraphBarIcon: ca,
        GraphLineIcon: sa,
        GraphqlIcon: ua,
        GridAltIcon: pa,
        GridIcon: da,
        GrowIcon: Y,
        HeartHollowIcon: Ia,
        HeartIcon: ma,
        HomeIcon: ha,
        HourglassIcon: fa,
        InfoIcon: ga,
        ItalicIcon: ba,
        JumpToIcon: ya,
        KeyIcon: wa,
        LightningIcon: Sa,
        LightningOffIcon: va,
        LinkBrokenIcon: _a,
        LinkIcon: Ca,
        LinkedinIcon: ka,
        LinuxIcon: Ea,
        ListOrderedIcon: Ta,
        ListUnorderedIcon: Ra,
        LocationIcon: Aa,
        LockIcon: xa,
        MarkdownIcon: Oa,
        MarkupIcon: La,
        MediumIcon: Pa,
        MemoryIcon: Ba,
        MenuIcon: Ma,
        MergeIcon: Va,
        MirrorIcon: Da,
        MobileIcon: re,
        MoonIcon: Na,
        NutIcon: Ua,
        OutboxIcon: za,
        OutlineIcon: Ha,
        PaintBrushIcon: Ga,
        PaperClipIcon: Fa,
        ParagraphIcon: qa,
        PassedIcon: Wa,
        PhoneIcon: ja,
        PhotoDragIcon: Ya,
        PhotoIcon: Ka,
        PhotoStabilizeIcon: Za,
        PinAltIcon: Xa,
        PinIcon: $a,
        PlayAllHollowIcon: Ja,
        PlayBackIcon: Qa,
        PlayHollowIcon: el,
        PlayIcon: tl,
        PlayNextIcon: ol,
        PlusIcon: nl,
        PointerDefaultIcon: rl,
        PointerHandIcon: il,
        PowerIcon: al,
        PrintIcon: ll,
        ProceedIcon: cl,
        ProfileIcon: sl,
        PullRequestIcon: ul,
        QuestionIcon: pl,
        RSSIcon: dl,
        RedirectIcon: Il,
        ReduxIcon: ml,
        RefreshIcon: ie,
        ReplyIcon: hl,
        RepoIcon: fl,
        RequestChangeIcon: gl,
        RewindIcon: bl,
        RulerIcon: yl,
        SaveIcon: wl,
        SearchIcon: Sl,
        ShareAltIcon: vl,
        ShareIcon: _l,
        ShieldIcon: Cl,
        SideBySideIcon: kl,
        SidebarAltIcon: El,
        SidebarAltToggleIcon: Tl,
        SidebarIcon: Rl,
        SidebarToggleIcon: Al,
        SpeakerIcon: xl,
        StackedIcon: Ol,
        StarHollowIcon: Ll,
        StarIcon: Pl,
        StatusFailIcon: Bl,
        StatusIcon: Ml,
        StatusPassIcon: Vl,
        StatusWarnIcon: Dl,
        StickerIcon: Nl,
        StopAltHollowIcon: Ul,
        StopAltIcon: zl,
        StopIcon: Hl,
        StorybookIcon: Gl,
        StructureIcon: Fl,
        SubtractIcon: ql,
        SunIcon: Wl,
        SupportIcon: jl,
        SweepIcon: Yl,
        SwitchAltIcon: Kl,
        SyncIcon: Zl,
        TabletIcon: ae,
        ThumbsUpIcon: Xl,
        TimeIcon: $l,
        TimerIcon: Jl,
        TransferIcon: K,
        TrashIcon: Ql,
        TwitterIcon: ec,
        TypeIcon: tc,
        UbuntuIcon: oc,
        UndoIcon: nc,
        UnfoldIcon: rc,
        UnlockIcon: ic,
        UnpinIcon: ac,
        UploadIcon: lc,
        UserAddIcon: cc,
        UserAltIcon: sc,
        UserIcon: uc,
        UsersIcon: pc,
        VSCodeIcon: dc,
        VerifiedIcon: Ic,
        VideoIcon: mc,
        WandIcon: hc,
        WatchIcon: fc,
        WindowsIcon: gc,
        WrenchIcon: bc,
        XIcon: yc,
        YoutubeIcon: wc,
        ZoomIcon: Sc,
        ZoomOutIcon: vc,
        ZoomResetIcon: _c,
        iconList: Cc,
      } = __STORYBOOK_ICONS__;
    var X = Se(ce()),
      P = "storybook/viewport",
      A = "viewport",
      pe = {
        mobile1: {
          name: "Small mobile",
          styles: { height: "568px", width: "320px" },
          type: "mobile",
        },
        mobile2: {
          name: "Large mobile",
          styles: { height: "896px", width: "414px" },
          type: "mobile",
        },
        tablet: { name: "Tablet", styles: { height: "1112px", width: "834px" }, type: "tablet" },
      },
      B = { name: "Reset viewport", styles: { height: "100%", width: "100%" }, type: "desktop" },
      _e = { [A]: { value: void 0, isRotated: !1 } },
      Ce = { viewport: "reset", viewportRotated: !1 },
      ke = globalThis.FEATURES?.viewportStoryGlobals ? _e : Ce,
      de = (e, t) => e.indexOf(t),
      Ee = (e, t) => {
        let a = de(e, t);
        return a === e.length - 1 ? e[0] : e[a + 1];
      },
      Te = (e, t) => {
        let a = de(e, t);
        return a < 1 ? e[e.length - 1] : e[a - 1];
      },
      Ie = async (e, t, a, s) => {
        (await e.setAddonShortcut(P, {
          label: "Previous viewport",
          defaultShortcut: ["alt", "shift", "V"],
          actionName: "previous",
          action: () => {
            a({ viewport: Te(s, t) });
          },
        }),
          await e.setAddonShortcut(P, {
            label: "Next viewport",
            defaultShortcut: ["alt", "V"],
            actionName: "next",
            action: () => {
              a({ viewport: Ee(s, t) });
            },
          }),
          await e.setAddonShortcut(P, {
            label: "Reset viewport",
            defaultShortcut: ["alt", "control", "V"],
            actionName: "reset",
            action: () => {
              a(ke);
            },
          }));
      },
      Re = v.div({ display: "inline-flex", alignItems: "center" }),
      se = v.div(({ theme: e }) => ({
        display: "inline-block",
        textDecoration: "none",
        padding: 10,
        fontWeight: e.typography.weight.bold,
        fontSize: e.typography.size.s2 - 1,
        lineHeight: "1",
        height: 40,
        border: "none",
        borderTop: "3px solid transparent",
        borderBottom: "3px solid transparent",
        background: "transparent",
      })),
      Ae = v(L)(() => ({ display: "inline-flex", alignItems: "center" })),
      xe = v.div(({ theme: e }) => ({ fontSize: e.typography.size.s2 - 1, marginLeft: 10 })),
      Oe = {
        desktop: c.createElement(ne, null),
        mobile: c.createElement(re, null),
        tablet: c.createElement(ae, null),
        other: c.createElement(V, null),
      },
      Le = ({ api: e }) => {
        let t = F(A),
          [a, s, l] = G(),
          [y, d] = z(!1),
          { options: o = pe, disable: i } = t || {},
          m = a?.[A] || {},
          n = m.value,
          I = m.isRotated,
          r = o[n] || B,
          u = y || r !== B,
          p = A in l,
          h = Object.keys(o).length;
        if (
          (O(() => {
            Ie(e, n, s, Object.keys(o));
          }, [o, n, s, e]),
          r.styles === null || !o || h < 1)
        )
          return null;
        if (typeof r.styles == "function")
          return (
            console.warn(
              "Addon Viewport no longer supports dynamic styles using a function, use css calc() instead"
            ),
            null
          );
        let w = I ? r.styles.height : r.styles.width,
          T = I ? r.styles.width : r.styles.height;
        return i
          ? null
          : c.createElement(Pe, {
              item: r,
              updateGlobals: s,
              viewportMap: o,
              viewportName: n,
              isRotated: I,
              setIsTooltipVisible: d,
              isLocked: p,
              isActive: u,
              width: w,
              height: T,
            });
      },
      Pe = c.memo(function (e) {
        let {
            item: t,
            viewportMap: a,
            viewportName: s,
            isRotated: l,
            updateGlobals: y,
            setIsTooltipVisible: d,
            isLocked: o,
            isActive: i,
            width: m,
            height: n,
          } = e,
          I = Q((r) => y({ [A]: r }), [y]);
        return c.createElement(
          V,
          null,
          c.createElement(
            W,
            {
              placement: "bottom",
              tooltip: ({ onHide: r }) =>
                c.createElement(q, {
                  links: [
                    ...(length > 0 && t !== B
                      ? [
                          {
                            id: "reset",
                            title: "Reset viewport",
                            icon: c.createElement(ie, null),
                            onClick: () => {
                              (I({ value: void 0, isRotated: !1 }), r());
                            },
                          },
                        ]
                      : []),
                    ...Object.entries(a).map(([u, p]) => ({
                      id: u,
                      title: p.name,
                      icon: Oe[p.type],
                      active: u === s,
                      onClick: () => {
                        (I({ value: u, isRotated: !1 }), r());
                      },
                    })),
                  ].flat(),
                }),
              closeOnOutsideClick: !0,
              onVisibleChange: d,
            },
            c.createElement(
              Ae,
              {
                disabled: o,
                key: "viewport",
                title: "Change the size of the preview",
                active: i,
                onDoubleClick: () => {
                  I({ value: void 0, isRotated: !1 });
                },
              },
              c.createElement(Y, null),
              t !== B ? c.createElement(xe, null, t.name, " ", l ? "(L)" : "(P)") : null
            )
          ),
          c.createElement(j, {
            styles: { 'iframe[data-is-storybook="true"]': { width: m, height: n } },
          }),
          t !== B
            ? c.createElement(
                Re,
                null,
                c.createElement(se, { title: "Viewport width" }, m.replace("px", "")),
                o
                  ? "/"
                  : c.createElement(
                      L,
                      {
                        key: "viewport-rotate",
                        title: "Rotate viewport",
                        onClick: () => {
                          I({ value: s, isRotated: !l });
                        },
                      },
                      c.createElement(K, null)
                    ),
                c.createElement(se, { title: "Viewport height" }, n.replace("px", ""))
              )
            : null
        );
      }),
      Be = (0, X.default)(50)((e) => [
        ...Me,
        ...Object.entries(e).map(([t, { name: a, ...s }]) => ({ ...s, id: t, title: a })),
      ]),
      D = { id: "reset", title: "Reset viewport", styles: null, type: "other" },
      Me = [D],
      Ve = (0, X.default)(50)((e, t, a, s) =>
        e
          .filter((l) => l.id !== D.id || t.id !== l.id)
          .map((l) => ({
            ...l,
            onClick: () => {
              (a({ viewport: l.id }), s());
            },
          }))
      ),
      De = ({ width: e, height: t, ...a }) => ({ ...a, height: e, width: t }),
      Ne = v.div({ display: "inline-flex", alignItems: "center" }),
      ue = v.div(({ theme: e }) => ({
        display: "inline-block",
        textDecoration: "none",
        padding: 10,
        fontWeight: e.typography.weight.bold,
        fontSize: e.typography.size.s2 - 1,
        lineHeight: "1",
        height: 40,
        border: "none",
        borderTop: "3px solid transparent",
        borderBottom: "3px solid transparent",
        background: "transparent",
      })),
      Ue = v(L)(() => ({ display: "inline-flex", alignItems: "center" })),
      ze = v.div(({ theme: e }) => ({ fontSize: e.typography.size.s2 - 1, marginLeft: 10 })),
      He = (e, t, a) => {
        if (t === null) return;
        let s = typeof t == "function" ? t(e) : t;
        return a ? De(s) : s;
      },
      Ge = J(function () {
        let [e, t] = G(),
          { viewports: a = pe, defaultOrientation: s, defaultViewport: l, disable: y } = F(A, {}),
          d = Be(a),
          o = oe(),
          [i, m] = z(!1);
        (l &&
          !d.find((u) => u.id === l) &&
          console.warn(
            `Cannot find "defaultViewport" of "${l}" in addon-viewport configs, please check the "viewports" setting in the configuration.`
          ),
          O(() => {
            Ie(o, e, t, Object.keys(a));
          }, [a, e, e.viewport, t, o]),
          O(() => {
            let u = s === "landscape";
            ((l && e.viewport !== l) || (s && e.viewportRotated !== u)) &&
              t({ viewport: l, viewportRotated: u });
          }, [s, l, t]));
        let n =
            d.find((u) => u.id === e.viewport) ||
            d.find((u) => u.id === l) ||
            d.find((u) => u.default) ||
            D,
          I = ee(),
          r = He(I.current, n.styles, e.viewportRotated);
        return (
          O(() => {
            I.current = r;
          }, [n]),
          y || Object.entries(a).length === 0
            ? null
            : c.createElement(
                V,
                null,
                c.createElement(
                  W,
                  {
                    placement: "top",
                    tooltip: ({ onHide: u }) => c.createElement(q, { links: Ve(d, n, t, u) }),
                    closeOnOutsideClick: !0,
                    onVisibleChange: m,
                  },
                  c.createElement(
                    Ue,
                    {
                      key: "viewport",
                      title: "Change the size of the preview",
                      active: i || !!r,
                      onDoubleClick: () => {
                        t({ viewport: D.id });
                      },
                    },
                    c.createElement(Y, null),
                    r
                      ? c.createElement(
                          ze,
                          null,
                          e.viewportRotated ? `${n.title} (L)` : `${n.title} (P)`
                        )
                      : null
                  )
                ),
                r
                  ? c.createElement(
                      Ne,
                      null,
                      c.createElement(j, {
                        styles: {
                          'iframe[data-is-storybook="true"]': {
                            ...(r || { width: "100%", height: "100%" }),
                          },
                        },
                      }),
                      c.createElement(ue, { title: "Viewport width" }, r.width.replace("px", "")),
                      c.createElement(
                        L,
                        {
                          key: "viewport-rotate",
                          title: "Rotate viewport",
                          onClick: () => {
                            t({ viewportRotated: !e.viewportRotated });
                          },
                        },
                        c.createElement(K, null)
                      ),
                      c.createElement(ue, { title: "Viewport height" }, r.height.replace("px", ""))
                    )
                  : null
              )
        );
      });
    H.register(P, (e) => {
      H.add(P, {
        title: "viewport / media-queries",
        type: te.TOOL,
        match: ({ viewMode: t, tabId: a }) => t === "story" && !a,
        render: () => (FEATURES?.viewportStoryGlobals ? U(Le, { api: e }) : U(Ge, null)),
      });
    });
  })();
} catch (e) {
  console.error("[Storybook] One of your manager-entries failed: " + import.meta.url, e);
}
