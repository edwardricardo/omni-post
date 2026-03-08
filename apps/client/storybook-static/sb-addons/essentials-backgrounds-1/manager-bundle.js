try {
  (() => {
    var re = Object.create;
    var Y = Object.defineProperty;
    var ae = Object.getOwnPropertyDescriptor;
    var ie = Object.getOwnPropertyNames;
    var ce = Object.getPrototypeOf,
      se = Object.prototype.hasOwnProperty;
    var E = ((e) =>
      typeof require < "u"
        ? require
        : typeof Proxy < "u"
          ? new Proxy(e, { get: (o, c) => (typeof require < "u" ? require : o)[c] })
          : e)(function (e) {
      if (typeof require < "u") return require.apply(this, arguments);
      throw Error('Dynamic require of "' + e + '" is not supported');
    });
    var M = (e, o) => () => (e && (o = e((e = 0))), o);
    var le = (e, o) => () => (o || e((o = { exports: {} }).exports, o), o.exports);
    var ue = (e, o, c, r) => {
      if ((o && typeof o == "object") || typeof o == "function")
        for (let a of ie(o))
          !se.call(e, a) &&
            a !== c &&
            Y(e, a, { get: () => o[a], enumerable: !(r = ae(o, a)) || r.enumerable });
      return e;
    };
    var de = (e, o, c) => (
      (c = e != null ? re(ce(e)) : {}),
      ue(o || !e || !e.__esModule ? Y(c, "default", { value: e, enumerable: !0 }) : c, e)
    );
    var m = M(() => {});
    var h = M(() => {});
    var f = M(() => {});
    var Q = le((J, j) => {
      m();
      h();
      f();
      (function (e) {
        if (typeof J == "object" && typeof j < "u") j.exports = e();
        else if (typeof define == "function" && define.amd) define([], e);
        else {
          var o;
          (typeof window < "u" || typeof window < "u"
            ? (o = window)
            : typeof self < "u"
              ? (o = self)
              : (o = this),
            (o.memoizerific = e()));
        }
      })(function () {
        var e, o, c;
        return (function r(a, I, s) {
          function n(i, d) {
            if (!I[i]) {
              if (!a[i]) {
                var l = typeof E == "function" && E;
                if (!d && l) return l(i, !0);
                if (t) return t(i, !0);
                var _ = new Error("Cannot find module '" + i + "'");
                throw ((_.code = "MODULE_NOT_FOUND"), _);
              }
              var p = (I[i] = { exports: {} });
              a[i][0].call(
                p.exports,
                function (b) {
                  var y = a[i][1][b];
                  return n(y || b);
                },
                p,
                p.exports,
                r,
                a,
                I,
                s
              );
            }
            return I[i].exports;
          }
          for (var t = typeof E == "function" && E, u = 0; u < s.length; u++) n(s[u]);
          return n;
        })(
          {
            1: [
              function (r, a, I) {
                a.exports = function (s) {
                  if (typeof Map != "function" || s) {
                    var n = r("./similar");
                    return new n();
                  } else return new Map();
                };
              },
              { "./similar": 2 },
            ],
            2: [
              function (r, a, I) {
                function s() {
                  return ((this.list = []), (this.lastItem = void 0), (this.size = 0), this);
                }
                ((s.prototype.get = function (n) {
                  var t;
                  if (this.lastItem && this.isEqual(this.lastItem.key, n)) return this.lastItem.val;
                  if (((t = this.indexOf(n)), t >= 0))
                    return ((this.lastItem = this.list[t]), this.list[t].val);
                }),
                  (s.prototype.set = function (n, t) {
                    var u;
                    return this.lastItem && this.isEqual(this.lastItem.key, n)
                      ? ((this.lastItem.val = t), this)
                      : ((u = this.indexOf(n)),
                        u >= 0
                          ? ((this.lastItem = this.list[u]), (this.list[u].val = t), this)
                          : ((this.lastItem = { key: n, val: t }),
                            this.list.push(this.lastItem),
                            this.size++,
                            this));
                  }),
                  (s.prototype.delete = function (n) {
                    var t;
                    if (
                      (this.lastItem &&
                        this.isEqual(this.lastItem.key, n) &&
                        (this.lastItem = void 0),
                      (t = this.indexOf(n)),
                      t >= 0)
                    )
                      return (this.size--, this.list.splice(t, 1)[0]);
                  }),
                  (s.prototype.has = function (n) {
                    var t;
                    return this.lastItem && this.isEqual(this.lastItem.key, n)
                      ? !0
                      : ((t = this.indexOf(n)), t >= 0 ? ((this.lastItem = this.list[t]), !0) : !1);
                  }),
                  (s.prototype.forEach = function (n, t) {
                    var u;
                    for (u = 0; u < this.size; u++)
                      n.call(t || this, this.list[u].val, this.list[u].key, this);
                  }),
                  (s.prototype.indexOf = function (n) {
                    var t;
                    for (t = 0; t < this.size; t++) if (this.isEqual(this.list[t].key, n)) return t;
                    return -1;
                  }),
                  (s.prototype.isEqual = function (n, t) {
                    return n === t || (n !== n && t !== t);
                  }),
                  (a.exports = s));
              },
              {},
            ],
            3: [
              function (r, a, I) {
                var s = r("map-or-similar");
                a.exports = function (i) {
                  var d = new s(!1),
                    l = [];
                  return function (_) {
                    var p = function () {
                      var b = d,
                        y,
                        R,
                        T = arguments.length - 1,
                        L = Array(T + 1),
                        O = !0,
                        A;
                      if ((p.numArgs || p.numArgs === 0) && p.numArgs !== T + 1)
                        throw new Error(
                          "Memoizerific functions should always be called with the same number of arguments"
                        );
                      for (A = 0; A < T; A++) {
                        if (((L[A] = { cacheItem: b, arg: arguments[A] }), b.has(arguments[A]))) {
                          b = b.get(arguments[A]);
                          continue;
                        }
                        ((O = !1), (y = new s(!1)), b.set(arguments[A], y), (b = y));
                      }
                      return (
                        O && (b.has(arguments[T]) ? (R = b.get(arguments[T])) : (O = !1)),
                        O || ((R = _.apply(null, arguments)), b.set(arguments[T], R)),
                        i > 0 &&
                          ((L[T] = { cacheItem: b, arg: arguments[T] }),
                          O ? n(l, L) : l.push(L),
                          l.length > i && t(l.shift())),
                        (p.wasMemoized = O),
                        (p.numArgs = T + 1),
                        R
                      );
                    };
                    return ((p.limit = i), (p.wasMemoized = !1), (p.cache = d), (p.lru = l), p);
                  };
                };
                function n(i, d) {
                  var l = i.length,
                    _ = d.length,
                    p,
                    b,
                    y;
                  for (b = 0; b < l; b++) {
                    for (p = !0, y = 0; y < _; y++)
                      if (!u(i[b][y].arg, d[y].arg)) {
                        p = !1;
                        break;
                      }
                    if (p) break;
                  }
                  i.push(i.splice(b, 1)[0]);
                }
                function t(i) {
                  var d = i.length,
                    l = i[d - 1],
                    _,
                    p;
                  for (
                    l.cacheItem.delete(l.arg), p = d - 2;
                    p >= 0 && ((l = i[p]), (_ = l.cacheItem.get(l.arg)), !_ || !_.size);
                    p--
                  )
                    l.cacheItem.delete(l.arg);
                }
                function u(i, d) {
                  return i === d || (i !== i && d !== d);
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
    m();
    h();
    f();
    m();
    h();
    f();
    m();
    h();
    f();
    m();
    h();
    f();
    var g = __REACT__,
      {
        Children: Ee,
        Component: we,
        Fragment: D,
        Profiler: Be,
        PureComponent: Re,
        StrictMode: Le,
        Suspense: xe,
        __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: Pe,
        cloneElement: Me,
        createContext: De,
        createElement: Ge,
        createFactory: Ue,
        createRef: Ne,
        forwardRef: Fe,
        isValidElement: He,
        lazy: qe,
        memo: w,
        startTransition: ze,
        unstable_act: Ke,
        useCallback: G,
        useContext: je,
        useDebugValue: Ve,
        useDeferredValue: Ye,
        useEffect: We,
        useId: $e,
        useImperativeHandle: Ze,
        useInsertionEffect: Xe,
        useLayoutEffect: Je,
        useMemo: W,
        useReducer: Qe,
        useRef: eo,
        useState: U,
        useSyncExternalStore: oo,
        useTransition: to,
        version: no,
      } = __REACT__;
    m();
    h();
    f();
    var so = __STORYBOOK_API__,
      {
        ActiveTabs: lo,
        Consumer: uo,
        ManagerContext: Io,
        Provider: po,
        RequestResponseError: mo,
        addons: N,
        combineParameters: ho,
        controlOrMetaKey: fo,
        controlOrMetaSymbol: go,
        eventMatchesShortcut: bo,
        eventToShortcut: _o,
        experimental_MockUniversalStore: yo,
        experimental_UniversalStore: So,
        experimental_requestResponse: Co,
        experimental_useUniversalStore: ko,
        isMacLike: vo,
        isShortcutTaken: To,
        keyToSymbol: Ao,
        merge: Oo,
        mockChannel: Eo,
        optionOrAltSymbol: wo,
        shortcutMatchesShortcut: Bo,
        shortcutToHumanString: Ro,
        types: $,
        useAddonState: Lo,
        useArgTypes: xo,
        useArgs: Po,
        useChannel: Mo,
        useGlobalTypes: Do,
        useGlobals: x,
        useParameter: P,
        useSharedState: Go,
        useStoryPrepared: Uo,
        useStorybookApi: No,
        useStorybookState: Fo,
      } = __STORYBOOK_API__;
    m();
    h();
    f();
    var jo = __STORYBOOK_COMPONENTS__,
      {
        A: Vo,
        ActionBar: Yo,
        AddonPanel: Wo,
        Badge: $o,
        Bar: Zo,
        Blockquote: Xo,
        Button: Jo,
        ClipboardCode: Qo,
        Code: et,
        DL: ot,
        Div: tt,
        DocumentWrapper: nt,
        EmptyTabContent: rt,
        ErrorFormatter: at,
        FlexBar: it,
        Form: ct,
        H1: st,
        H2: lt,
        H3: ut,
        H4: dt,
        H5: It,
        H6: pt,
        HR: mt,
        IconButton: B,
        IconButtonSkeleton: ht,
        Icons: ft,
        Img: gt,
        LI: bt,
        Link: _t,
        ListItem: yt,
        Loader: St,
        Modal: Ct,
        OL: kt,
        P: vt,
        Placeholder: Tt,
        Pre: At,
        ProgressSpinner: Ot,
        ResetWrapper: Et,
        ScrollArea: wt,
        Separator: Bt,
        Spaced: Rt,
        Span: Lt,
        StorybookIcon: xt,
        StorybookLogo: Pt,
        Symbols: Mt,
        SyntaxHighlighter: Dt,
        TT: Gt,
        TabBar: Ut,
        TabButton: Nt,
        TabWrapper: Ft,
        Table: Ht,
        Tabs: qt,
        TabsState: zt,
        TooltipLinkList: F,
        TooltipMessage: Kt,
        TooltipNote: jt,
        UL: Vt,
        WithTooltip: H,
        WithTooltipPure: Yt,
        Zoom: Wt,
        codeCommon: $t,
        components: Zt,
        createCopyToClipboardFunction: Xt,
        getStoryHref: Jt,
        icons: Qt,
        interleaveSeparators: en,
        nameSpaceClassNames: on,
        resetComponents: tn,
        withReset: nn,
      } = __STORYBOOK_COMPONENTS__;
    m();
    h();
    f();
    var ln = __STORYBOOK_ICONS__,
      {
        AccessibilityAltIcon: un,
        AccessibilityIcon: dn,
        AccessibilityIgnoredIcon: In,
        AddIcon: pn,
        AdminIcon: mn,
        AlertAltIcon: hn,
        AlertIcon: fn,
        AlignLeftIcon: gn,
        AlignRightIcon: bn,
        AppleIcon: _n,
        ArrowBottomLeftIcon: yn,
        ArrowBottomRightIcon: Sn,
        ArrowDownIcon: Cn,
        ArrowLeftIcon: kn,
        ArrowRightIcon: vn,
        ArrowSolidDownIcon: Tn,
        ArrowSolidLeftIcon: An,
        ArrowSolidRightIcon: On,
        ArrowSolidUpIcon: En,
        ArrowTopLeftIcon: wn,
        ArrowTopRightIcon: Bn,
        ArrowUpIcon: Rn,
        AzureDevOpsIcon: Ln,
        BackIcon: xn,
        BasketIcon: Pn,
        BatchAcceptIcon: Mn,
        BatchDenyIcon: Dn,
        BeakerIcon: Gn,
        BellIcon: Un,
        BitbucketIcon: Nn,
        BoldIcon: Fn,
        BookIcon: Hn,
        BookmarkHollowIcon: qn,
        BookmarkIcon: zn,
        BottomBarIcon: Kn,
        BottomBarToggleIcon: jn,
        BoxIcon: Vn,
        BranchIcon: Yn,
        BrowserIcon: Wn,
        ButtonIcon: $n,
        CPUIcon: Zn,
        CalendarIcon: Xn,
        CameraIcon: Jn,
        CameraStabilizeIcon: Qn,
        CategoryIcon: er,
        CertificateIcon: or,
        ChangedIcon: tr,
        ChatIcon: nr,
        CheckIcon: rr,
        ChevronDownIcon: ar,
        ChevronLeftIcon: ir,
        ChevronRightIcon: cr,
        ChevronSmallDownIcon: sr,
        ChevronSmallLeftIcon: lr,
        ChevronSmallRightIcon: ur,
        ChevronSmallUpIcon: dr,
        ChevronUpIcon: Ir,
        ChromaticIcon: pr,
        ChromeIcon: mr,
        CircleHollowIcon: hr,
        CircleIcon: Z,
        ClearIcon: fr,
        CloseAltIcon: gr,
        CloseIcon: br,
        CloudHollowIcon: _r,
        CloudIcon: yr,
        CogIcon: Sr,
        CollapseIcon: Cr,
        CommandIcon: kr,
        CommentAddIcon: vr,
        CommentIcon: Tr,
        CommentsIcon: Ar,
        CommitIcon: Or,
        CompassIcon: Er,
        ComponentDrivenIcon: wr,
        ComponentIcon: Br,
        ContrastIcon: Rr,
        ContrastIgnoredIcon: Lr,
        ControlsIcon: xr,
        CopyIcon: Pr,
        CreditIcon: Mr,
        CrossIcon: Dr,
        DashboardIcon: Gr,
        DatabaseIcon: Ur,
        DeleteIcon: Nr,
        DiamondIcon: Fr,
        DirectionIcon: Hr,
        DiscordIcon: qr,
        DocChartIcon: zr,
        DocListIcon: Kr,
        DocumentIcon: jr,
        DownloadIcon: Vr,
        DragIcon: Yr,
        EditIcon: Wr,
        EllipsisIcon: $r,
        EmailIcon: Zr,
        ExpandAltIcon: Xr,
        ExpandIcon: Jr,
        EyeCloseIcon: Qr,
        EyeIcon: ea,
        FaceHappyIcon: oa,
        FaceNeutralIcon: ta,
        FaceSadIcon: na,
        FacebookIcon: ra,
        FailedIcon: aa,
        FastForwardIcon: ia,
        FigmaIcon: ca,
        FilterIcon: sa,
        FlagIcon: la,
        FolderIcon: ua,
        FormIcon: da,
        GDriveIcon: Ia,
        GithubIcon: pa,
        GitlabIcon: ma,
        GlobeIcon: ha,
        GoogleIcon: fa,
        GraphBarIcon: ga,
        GraphLineIcon: ba,
        GraphqlIcon: _a,
        GridAltIcon: ya,
        GridIcon: q,
        GrowIcon: Sa,
        HeartHollowIcon: Ca,
        HeartIcon: ka,
        HomeIcon: va,
        HourglassIcon: Ta,
        InfoIcon: Aa,
        ItalicIcon: Oa,
        JumpToIcon: Ea,
        KeyIcon: wa,
        LightningIcon: Ba,
        LightningOffIcon: Ra,
        LinkBrokenIcon: La,
        LinkIcon: xa,
        LinkedinIcon: Pa,
        LinuxIcon: Ma,
        ListOrderedIcon: Da,
        ListUnorderedIcon: Ga,
        LocationIcon: Ua,
        LockIcon: Na,
        MarkdownIcon: Fa,
        MarkupIcon: Ha,
        MediumIcon: qa,
        MemoryIcon: za,
        MenuIcon: Ka,
        MergeIcon: ja,
        MirrorIcon: Va,
        MobileIcon: Ya,
        MoonIcon: Wa,
        NutIcon: $a,
        OutboxIcon: Za,
        OutlineIcon: Xa,
        PaintBrushIcon: Ja,
        PaperClipIcon: Qa,
        ParagraphIcon: ei,
        PassedIcon: oi,
        PhoneIcon: ti,
        PhotoDragIcon: ni,
        PhotoIcon: z,
        PhotoStabilizeIcon: ri,
        PinAltIcon: ai,
        PinIcon: ii,
        PlayAllHollowIcon: ci,
        PlayBackIcon: si,
        PlayHollowIcon: li,
        PlayIcon: ui,
        PlayNextIcon: di,
        PlusIcon: Ii,
        PointerDefaultIcon: pi,
        PointerHandIcon: mi,
        PowerIcon: hi,
        PrintIcon: fi,
        ProceedIcon: gi,
        ProfileIcon: bi,
        PullRequestIcon: _i,
        QuestionIcon: yi,
        RSSIcon: Si,
        RedirectIcon: Ci,
        ReduxIcon: ki,
        RefreshIcon: X,
        ReplyIcon: vi,
        RepoIcon: Ti,
        RequestChangeIcon: Ai,
        RewindIcon: Oi,
        RulerIcon: Ei,
        SaveIcon: wi,
        SearchIcon: Bi,
        ShareAltIcon: Ri,
        ShareIcon: Li,
        ShieldIcon: xi,
        SideBySideIcon: Pi,
        SidebarAltIcon: Mi,
        SidebarAltToggleIcon: Di,
        SidebarIcon: Gi,
        SidebarToggleIcon: Ui,
        SpeakerIcon: Ni,
        StackedIcon: Fi,
        StarHollowIcon: Hi,
        StarIcon: qi,
        StatusFailIcon: zi,
        StatusIcon: Ki,
        StatusPassIcon: ji,
        StatusWarnIcon: Vi,
        StickerIcon: Yi,
        StopAltHollowIcon: Wi,
        StopAltIcon: $i,
        StopIcon: Zi,
        StorybookIcon: Xi,
        StructureIcon: Ji,
        SubtractIcon: Qi,
        SunIcon: ec,
        SupportIcon: oc,
        SweepIcon: tc,
        SwitchAltIcon: nc,
        SyncIcon: rc,
        TabletIcon: ac,
        ThumbsUpIcon: ic,
        TimeIcon: cc,
        TimerIcon: sc,
        TransferIcon: lc,
        TrashIcon: uc,
        TwitterIcon: dc,
        TypeIcon: Ic,
        UbuntuIcon: pc,
        UndoIcon: mc,
        UnfoldIcon: hc,
        UnlockIcon: fc,
        UnpinIcon: gc,
        UploadIcon: bc,
        UserAddIcon: _c,
        UserAltIcon: yc,
        UserIcon: Sc,
        UsersIcon: Cc,
        VSCodeIcon: kc,
        VerifiedIcon: vc,
        VideoIcon: Tc,
        WandIcon: Ac,
        WatchIcon: Oc,
        WindowsIcon: Ec,
        WrenchIcon: wc,
        XIcon: Bc,
        YoutubeIcon: Rc,
        ZoomIcon: Lc,
        ZoomOutIcon: xc,
        ZoomResetIcon: Pc,
        iconList: Mc,
      } = __STORYBOOK_ICONS__;
    m();
    h();
    f();
    var Fc = __STORYBOOK_CLIENT_LOGGER__,
      { deprecate: Hc, logger: K, once: qc, pretty: zc } = __STORYBOOK_CLIENT_LOGGER__;
    var V = de(Q());
    m();
    h();
    f();
    var Jc = __STORYBOOK_THEMING__,
      {
        CacheProvider: Qc,
        ClassNames: es,
        Global: os,
        ThemeProvider: ts,
        background: ns,
        color: rs,
        convert: as,
        create: is,
        createCache: cs,
        createGlobal: ss,
        createReset: ls,
        css: us,
        darken: ds,
        ensure: Is,
        ignoreSsrWarning: ps,
        isPropValid: ms,
        jsx: hs,
        keyframes: fs,
        lighten: gs,
        styled: ee,
        themes: bs,
        typography: _s,
        useTheme: ys,
        withTheme: Ss,
      } = __STORYBOOK_THEMING__;
    m();
    h();
    f();
    function oe(e) {
      for (var o = [], c = 1; c < arguments.length; c++) o[c - 1] = arguments[c];
      var r = Array.from(typeof e == "string" ? [e] : e);
      r[r.length - 1] = r[r.length - 1].replace(/\r?\n([\t ]*)$/, "");
      var a = r.reduce(function (n, t) {
        var u = t.match(/\n([\t ]+|(?!\s).)/g);
        return u
          ? n.concat(
              u.map(function (i) {
                var d, l;
                return (l =
                  (d = i.match(/[\t ]/g)) === null || d === void 0 ? void 0 : d.length) !== null &&
                  l !== void 0
                  ? l
                  : 0;
              })
            )
          : n;
      }, []);
      if (a.length) {
        var I = new RegExp(
          `
[	 ]{` +
            Math.min.apply(Math, a) +
            "}",
          "g"
        );
        r = r.map(function (n) {
          return n.replace(
            I,
            `
`
          );
        });
      }
      r[0] = r[0].replace(/^\r?\n/, "");
      var s = r[0];
      return (
        o.forEach(function (n, t) {
          var u = s.match(/(?:^|\n)( *)$/),
            i = u ? u[1] : "",
            d = n;
          (typeof n == "string" &&
            n.includes(`
`) &&
            (d = String(n)
              .split(
                `
`
              )
              .map(function (l, _) {
                return _ === 0 ? l : "" + i + l;
              }).join(`
`)),
            (s += d + r[t + 1]));
        }),
        s
      );
    }
    var te = "storybook/background",
      S = "backgrounds",
      Ie = { light: { name: "light", value: "#F8F8F8" }, dark: { name: "dark", value: "#333" } },
      pe = w(function () {
        let e = P(S),
          [o, c, r] = x(),
          [a, I] = U(!1),
          { options: s = Ie, disable: n = !0 } = e || {};
        if (n) return null;
        let t = o[S] || {},
          u = t.value,
          i = t.grid || !1,
          d = s[u],
          l = !!r?.[S],
          _ = Object.keys(s).length;
        return g.createElement(me, {
          length: _,
          backgroundMap: s,
          item: d,
          updateGlobals: c,
          backgroundName: u,
          setIsTooltipVisible: I,
          isLocked: l,
          isGridActive: i,
          isTooltipVisible: a,
        });
      }),
      me = w(function (e) {
        let {
            item: o,
            length: c,
            updateGlobals: r,
            setIsTooltipVisible: a,
            backgroundMap: I,
            backgroundName: s,
            isLocked: n,
            isGridActive: t,
            isTooltipVisible: u,
          } = e,
          i = G(
            (d) => {
              r({ [S]: d });
            },
            [r]
          );
        return g.createElement(
          D,
          null,
          g.createElement(
            B,
            {
              key: "grid",
              active: t,
              disabled: n,
              title: "Apply a grid to the preview",
              onClick: () => i({ value: s, grid: !t }),
            },
            g.createElement(q, null)
          ),
          c > 0
            ? g.createElement(
                H,
                {
                  key: "background",
                  placement: "top",
                  closeOnOutsideClick: !0,
                  tooltip: ({ onHide: d }) =>
                    g.createElement(F, {
                      links: [
                        ...(o
                          ? [
                              {
                                id: "reset",
                                title: "Reset background",
                                icon: g.createElement(X, null),
                                onClick: () => {
                                  (i({ value: void 0, grid: t }), d());
                                },
                              },
                            ]
                          : []),
                        ...Object.entries(I).map(([l, _]) => ({
                          id: l,
                          title: _.name,
                          icon: g.createElement(Z, { color: _?.value || "grey" }),
                          active: l === s,
                          onClick: () => {
                            (i({ value: l, grid: t }), d());
                          },
                        })),
                      ].flat(),
                    }),
                  onVisibleChange: a,
                },
                g.createElement(
                  B,
                  {
                    disabled: n,
                    key: "background",
                    title: "Change the background of the preview",
                    active: !!o || u,
                  },
                  g.createElement(z, null)
                )
              )
            : null
        );
      }),
      he = ee.span(
        ({ background: e }) => ({
          borderRadius: "1rem",
          display: "block",
          height: "1rem",
          width: "1rem",
          background: e,
        }),
        ({ theme: e }) => ({ boxShadow: `${e.appBorderColor} 0 0 0 1px inset` })
      ),
      fe = (e, o = [], c) => {
        if (e === "transparent") return "transparent";
        if (o.find((a) => a.value === e) || e) return e;
        let r = o.find((a) => a.name === c);
        if (r) return r.value;
        if (c) {
          let a = o.map((I) => I.name).join(", ");
          K.warn(oe`
        Backgrounds Addon: could not find the default color "${c}".
        These are the available colors for your story based on your configuration:
        ${a}.
      `);
        }
        return "transparent";
      },
      ne = (0, V.default)(1e3)((e, o, c, r, a, I) => ({
        id: e || o,
        title: o,
        onClick: () => {
          a({ selected: c, name: o });
        },
        value: c,
        right: r ? g.createElement(he, { background: c }) : void 0,
        active: I,
      })),
      ge = (0, V.default)(10)((e, o, c) => {
        let r = e.map(({ name: a, value: I }) => ne(null, a, I, !0, c, I === o));
        return o !== "transparent"
          ? [ne("reset", "Clear background", "transparent", null, c, !1), ...r]
          : r;
      }),
      be = { default: null, disable: !0, values: [] },
      _e = w(function () {
        let e = P(S, be),
          [o, c] = U(!1),
          [r, a] = x(),
          I = r[S]?.value,
          s = W(() => fe(I, e.values, e.default), [e, I]);
        Array.isArray(e) &&
          K.warn(
            "Addon Backgrounds api has changed in Storybook 6.0. Please refer to the migration guide: https://github.com/storybookjs/storybook/blob/next/MIGRATION.md"
          );
        let n = G(
          (t) => {
            a({ [S]: { ...r[S], value: t } });
          },
          [e, r, a]
        );
        return e.disable
          ? null
          : g.createElement(
              H,
              {
                placement: "top",
                closeOnOutsideClick: !0,
                tooltip: ({ onHide: t }) =>
                  g.createElement(F, {
                    links: ge(e.values, s, ({ selected: u }) => {
                      (s !== u && n(u), t());
                    }),
                  }),
                onVisibleChange: c,
              },
              g.createElement(
                B,
                {
                  key: "background",
                  title: "Change the background of the preview",
                  active: s !== "transparent" || o,
                },
                g.createElement(z, null)
              )
            );
      }),
      ye = w(function () {
        let [e, o] = x(),
          { grid: c } = P(S, { grid: { disable: !1 } });
        if (c?.disable) return null;
        let r = e[S]?.grid || !1;
        return g.createElement(
          B,
          {
            key: "background",
            active: r,
            title: "Apply a grid to the preview",
            onClick: () => o({ [S]: { ...e[S], grid: !r } }),
          },
          g.createElement(q, null)
        );
      });
    N.register(te, () => {
      N.add(te, {
        title: "Backgrounds",
        type: $.TOOL,
        match: ({ viewMode: e, tabId: o }) => !!(e && e.match(/^(story|docs)$/)) && !o,
        render: () =>
          FEATURES?.backgroundsStoryGlobals
            ? g.createElement(pe, null)
            : g.createElement(D, null, g.createElement(_e, null), g.createElement(ye, null)),
      });
    });
  })();
} catch (e) {
  console.error("[Storybook] One of your manager-entries failed: " + import.meta.url, e);
}
