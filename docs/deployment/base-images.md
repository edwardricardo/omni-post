# Container base images

> The single source for WHY the four deployables run on the base they run on.
> The Dockerfiles point here instead of restating it, because the reasoning is
> identical for all four and a fact repeated four times is a fact that will be
> corrected in one of them.

**Owner:** Platform engineering

---

## What the four images run on

All four deployables (`api`, `workers`, `admin`, `client`) share one production
stage:

```
FROM gcr.io/distroless/nodejs26-debian13@sha256:<digest> AS production
```

The build chain stays on Debian bookworm, `node:26.12.1-bookworm-slim`, pinned by
digest as well. That asymmetry is deliberate and is explained under §"The glibc
direction" below. The Node 26 line arrived on 2026-10-15, ahead of its LTS date
([ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md)); §"Moved to Node 26
on 2026-10-15" below holds the measurements. Both stages moved to 26.12.1, the
security release of 2026-10-21, on 2026-10-22 (§"Moved to Node 26.12.1 on
2026-10-22").

---

## Why distroless

No shell, no package manager, no `apt`. That is the point: the smallest thing
that can run a Node process is also the smallest thing an attacker can reach.

It has a cost that is easy to mistake for a limitation of your own permissions:
**you cannot patch a distroless image from inside it.** There is no `apt-get
upgrade` to run because there is no `apt` binary. When a system library in the
base carries a CVE, the only real moves are to wait for the vendor to rebuild,
or to move to a base generation that already carries the fix.

Copying a patched `.so` in from the builder stage is not a third option. Trivy
reads `var/lib/dpkg/status.d`, not the binaries, so the report would keep naming
the old version while the library on disk was new — trading an honest red for an
image whose own inventory lies.

---

## Why debian13 and not debian12

Measured on 2026-09-24, by pulling each image's layers from gcr.io and reading
its own `var/lib/dpkg/status.d` — not inferred from the tag:

|         | `nodejs24-debian12`            | `nodejs24-debian13`              |
| ------- | ------------------------------ | -------------------------------- |
| openssl | `libssl3` **3.0.18-1~deb12u2** | `libssl3t64` **3.5.7-1~deb13u2** |
| glibc   | `libc6` 2.36-9+deb12u13        | `libc6` 2.41-12+deb13u4          |

The bookworm image's openssl carried one CRITICAL (CVE-2026-31789) and five HIGH
advisories, which failed the `Container Security` gate on all four services.
Debian had already published the fix — `openssl 3.0.20-1~deb12u2` is in bookworm
and the security tracker marks the CVEs resolved — but Google had not rebuilt
the bookworm distroless with it.

So the fix was not to wait for a rebuild that had not come. Trixie's image is
past every one of them, and past the `libc6` findings below the gate as well.

### Re-pinned on 2026-10-10: openssl `3.5.7-1~deb13u3`

CVE-2026-84782 (HIGH, an openssl information disclosure) reached
`libssl3t64 3.5.7-1~deb13u2`, the version inside the digest pinned on
2026-09-24 (`b1fc332`). It failed `Container Security` on all four services from
2026-10-07. Dependabot opened one pull request per service that day (#455 to
#458), each moving its own Dockerfile to `96df910`. Each turned only its own
image green, because the other three images still carried the old digest, so
no single one of them could pass.

Measured on 2026-10-10 by reading each image's own `var/lib/dpkg/status.d`:

|                       | `b1fc332` (2026-09-24)       | `96df910` (2026-10-10)           |
| --------------------- | ---------------------------- | -------------------------------- |
| openssl               | `libssl3t64` 3.5.7-1~deb13u2 | `libssl3t64` **3.5.7-1~deb13u3** |
| glibc                 | `libc6` 2.41-12+deb13u4      | `libc6` 2.41-12+deb13u4          |
| node                  | v24.21.0                     | v24.21.0                         |
| Trivy `HIGH,CRITICAL` | 1 (CVE-2026-84782)           | 0 (debian 13.7)                  |

Trivy 0.67.2 produced the last row. Only openssl moved, so one change re-pins
the four Dockerfiles together, and the four Dependabot pull requests close as
superseded.

### Moved to Node 26 on 2026-10-15

The owner moved the runtime to Node 26 ahead of its 2026-10-28 LTS date
([ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md)). Both stages of all
four Dockerfiles moved in one change:

| Stage      | Before                                         | After                                                               |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| build      | `node:24-bookworm-slim`, tag only              | `node:26.11.1-bookworm-slim@sha256:86f07bc9…`, the multi-arch index |
| production | `distroless/nodejs24-debian13@sha256:96df910…` | `distroless/nodejs26-debian13@sha256:746f728c…`, the `latest` index |

The build stage names an exact release, 26.11.1, the latest 26.x past the
7-day buffer and the version `actions/setup-node` resolves for `"26"`. The
distroless repository has no version tags: its `latest` index carried v26.12.0
(released 2026-10-14) when it was pinned, so build and runtime differ by one
minor. Every native addon in the tree is N-API, whose ABI holds across Node
releases, so nothing compiled in the build stage depends on that minor.

Measured on 2026-10-15 from the `linux/amd64` image of `746f728c` (manifest
`20dc887d…`), by reading its layers' own `var/lib/dpkg/status.d` and
`/nodejs/bin/node`:

|                       | `96df910` (nodejs24, 2026-10-10) | `746f728c` (nodejs26, 2026-10-15) |
| --------------------- | -------------------------------- | --------------------------------- |
| openssl               | `libssl3t64` 3.5.7-1~deb13u3     | `libssl3t64` 3.5.7-1~deb13u3      |
| glibc                 | `libc6` 2.41-12+deb13u4          | `libc6` 2.41-12+deb13u4           |
| node                  | v24.21.0                         | **v26.12.0**                      |
| Trivy `HIGH,CRITICAL` | 0 (debian 13.7)                  | 0 (debian 13.7)                   |

Trivy 0.75.0 produced the last cell of the new digest, over the same `linux/amd64`
image. Only node moved. The four images built from it with `podman` on the same
day each run `/nodejs/bin/node` v26.12.0 as `nonroot`; argon2 round-trips in the
API image, and both portal images answer 200 on `/api/health` and `/` and pass
`podman healthcheck run`. The re-check of 2026-10-28 re-reads the `latest` index
digest, because Google rebuilds it as Node 26 releases land.

### Moved to Node 26.12.1 on 2026-10-22

Node 26.12.1, released on 2026-10-21, fixes ten advisories on the 26.x line, four
of them High; one, a Brotli decoder out-of-bounds write, is reached by any
outbound `fetch` that reads a `br`-encoded body. The Node.js
[security releases of 2026-10-21](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
list them, and [ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md)
§"Amendment of 2026-10-22: Node 26.12.1" gives the reach of each in this
repository. The owner took it on 2026-10-22, inside the 7-day buffer (it matures
on 2026-10-28), in both stages of all four Dockerfiles:

| Stage      | Before                                          | After                                                                                                            |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| build      | `node:26.11.1-bookworm-slim@sha256:86f07bc9…`   | `node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe`             |
| production | `distroless/nodejs26-debian13@sha256:746f728c…` | `distroless/nodejs26-debian13@sha256:456bd22a48bc4b8b82b19041d7d9ff9c14e4ff0b80ea32c0b912be2f8288dbf7`, `latest` |

Both are multi-arch indexes, as before. The `latest` index of the distroless
repository moved to `456bd22a` on 2026-10-21T16:39Z, after three root-index
uploads in two days, and still pointed there when it was re-read on
2026-10-22T15:09:30Z; the tag `node:26.12.1-bookworm-slim` resolved to `28147155`
at the same instant.

Measured on 2026-10-22 from the `linux/amd64` image of each digest (production
manifest `26bc1224…`, build manifest `1884ec27…`):

|                       | `746f728c` (2026-10-15)      | `456bd22a` (2026-10-22)           |
| --------------------- | ---------------------------- | --------------------------------- |
| openssl               | `libssl3t64` 3.5.7-1~deb13u3 | `libssl3t64` 3.5.7-1~deb13u3      |
| glibc                 | `libc6` 2.41-12+deb13u4      | `libc6` 2.41-12+deb13u4           |
| ca-certificates       | 20250419                     | **20250419+deb13u1** (DSA-6572-1) |
| node                  | v26.12.0 (undici 8.11.2)     | **v26.12.1** (undici 8.12.2)      |
| Trivy `HIGH,CRITICAL` | 0 (debian 13.7)              | 0 (debian 13.7)                   |

Trivy 0.76.1, with the gate's flags and its database of 2026-10-22T13:15Z,
produced the last row. The build stage moved from v26.11.1 to v26.12.1 and kept
glibc 2.36-9+deb12u14 and npm 11.20.0, and it still ships no corepack. Build and
runtime now run the same release, which ends the one-minor difference of
2026-10-15. The four images built with `podman` from this change each run
`/nodejs/bin/node` v26.12.1 as `nonroot`; argon2 round-trips in the API image;
the API and workers `CMD` entries resolve their whole module graph and stop at
the environment validation, which this smoke does not satisfy; both portal
images answer 200 on `/api/health` and `/` and pass `podman healthcheck run`;
and Trivy, with the gate's flags, finds no HIGH or CRITICAL
vulnerability in any of the four (`debian 13.7` and 865, 542, 26 and 26
`node-pkg` targets for `api`, `workers`, `admin` and `client`).

The Trivy row stays at 0 because Trivy reports an image's Debian packages and the
`package.json` of each module under `node_modules`, never the `node` executable:
no gate saw that the images ran v26.12.0 after its advisories were published
(SMELL-207 in `docs/reports/roadmap-detected-smells-backlog.md`).

### pnpm in the build stage

Node 26 ships no corepack: it is "no longer distributed as of Node.js v25.0.0"
(nodejs/node#61207), and `node:26.12.1-bookworm-slim` carries `node`, `npm` and
`npx` only. Each build stage therefore installs pnpm 12.6.0 itself:

1. **The source** is pnpm's own GitHub release `v12.6.0`, an immutable release,
   so its assets cannot be replaced after publication.
2. **The check** is the sha256 GitHub records for each asset (`digest` in the
   release API), pinned per architecture in the Dockerfile:
   `pnpm-linux-x64.tar.gz` and `pnpm-linux-arm64.tar.gz`. pnpm publishes no
   separate checksum file. Downloading both assets on 2026-10-15 reproduced both
   digests.
3. **The architecture** comes from `dpkg --print-architecture`, the image's own,
   as the official Node image derives it. CI builds `linux/amd64` only (no
   `platforms:` in `production-ci.yml`); arm64 covers a local build on an arm64
   host.
4. **The download** uses node's built-in `fetch`, because the slim image has no
   `curl` or `wget` and adding them would mean an `apt-get` layer for one file. The fetch runs up to three times, 5 s then 10 s apart, and an attempt counts only once `sha256sum -c` accepts the archive, so one transient GitHub failure does not fail the image.
5. **The version contract** stays the root `package.json` `packageManager` field,
   `pnpm@12.6.0+sha512…`, which pnpm switches itself to when it differs from the
   running version (`managePackageManagerVersions`, on by default). A pnpm bump
   still moves the four Dockerfiles' version and digests in the same change, so
   the image builds with the release it verified.

The asset is pnpm's single executable, which embeds its own Node runtime. pnpm
runs lifecycle scripts with the `node` on `PATH`, the image's 26.12.1, and
compares `engines` against that same `node` when `engineStrict` asks it to
(measured on 2026-10-15: under Node 24.15.0 it reports `current:
{"node":"24.15.0"}`).

---

## Why the digest pin, and why it is only half a practice

A tag can be republished; a digest cannot. But a digest pinned and left alone is
worse than a floating tag, because it freezes whatever was current the day it
was written — pinning the bookworm digest would have pinned the vulnerability.

The other half is automation, and it already existed here:
`.github/dependabot.yml` declares the `docker` ecosystem for all four apps, and
**Dependabot updates a digest that is already pinned** with no further config.
It does **not** add one to a reference that has none.

That is what these four lines lacked. They read `FROM
gcr.io/distroless/nodejs24-debian12` — a bare repository reference, which
resolves to the `latest` tag (`debian12` is part of the repository NAME, not a
tag). Nothing tracked it: every build silently took whatever `latest` pointed at
that day, with no record of what changed or when.

The build stage read `node:24-bookworm-slim`, a floating tag, until 2026-10-15.
Since then it names an exact release and its index digest,
`node:26.12.1-bookworm-slim@sha256:…`, so Dependabot tracks both `FROM` lines of
every Dockerfile.

---

## The glibc direction

`argon2` ships a prebuilt native binary that must match the runtime ABI. The
build chain stays on `node:26.12.1-bookworm-slim` (glibc 2.36) while the runtime
is trixie (glibc 2.41).

That is the **safe** direction: glibc is forward-compatible, so a binary built
against 2.36 runs on 2.41. The reverse would not hold. OpenSSL keeps the
`libssl.so.3` soname across the whole 3.x series, so dynamic linking still
resolves against 3.5.

That argument is now backed by a reading of the binary and by a CI step that
actually starts the image. See §"What verifies it".

---

## What verifies it

**The glibc claim is measured, not argued.** `readelf -V` over
`argon2/prebuilds/linux-x64/argon2.glibc.node` shows the highest symbol version
it requires is `GLIBC_2.34`. Bookworm provided 2.36 and trixie provides 2.41, so
both satisfy it — forward compatibility is the reason it holds, and this reading
is the evidence that it does.

**And CI now runs the images it builds.** It did not: until the
`Smoke — the built image runs` step, four images were built, scanned, and pushed
on main without one of them ever being executed. The step sits BEFORE the
scanner on purpose, so a broken image says so even on a run where Trivy is red
for an unrelated advisory. It does two things:

1. Runs `node` in every image. Catches an architecture or loader break, which is
   the cheapest way a base swap goes wrong.
2. For `api`, requires `argon2` and round-trips a hash through `verify`.
   Requiring the PACKAGE is the honest test: argon2 ships prebuilds for many
   platforms and `node-gyp-build` picks one at require time, so walking for
   `*.node` and loading each would try the musl and foreign-architecture
   prebuilds and fail on files nothing was ever going to open.

`workers`, `admin` and `client` carry no native module of their own, so step 1 is
the whole of their coverage — the step says so in its own output rather than
letting a silent pass read as more than it is.

---

## How to extend

1. **Changing the base generation** → measure the candidate image's own
   `var/lib/dpkg/status.d` before proposing it, the way the table above was
   built. A tag name is not evidence of what is inside.
2. **Re-pinning the digest** → prefer letting Dependabot find the digest. Pin by
   hand only to move generations, or to take Dependabot's digest into all four
   services at once (item 3), and say why here.
3. **A base re-pin reaches all four services in one change.** Dependabot opens
   one pull request per service directory, and each stays red until the other
   three images move too, because every image is scanned in every run. Take the
   four digests together in one change, verify the new digest's
   `var/lib/dpkg/status.d` and its Trivy result first, and close the Dependabot
   pull requests as superseded.
4. **A base CVE with no fix in the current generation** → the choice is wait,
   move generation, or accept. Accepting goes through
   `docs/security/SECURITY_CANON.md` §"Audited audit-ignores" and its projection
   in `.trivyignore`, never a silent suppression.
5. **Moving the Node major** → both `FROM` lines of all four Dockerfiles move in
   the change that raises `.nvmrc`, every `engines.node` and the `@types/node`
   pin, so the images ship the major the engines gate holds CI and every manifest
   to. pnpm does not enforce it: with `engineStrict` unset it installs on any
   Node ([ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md)).
6. **Moving pnpm** → the version and both digests of §"pnpm in the build stage"
   move in all four Dockerfiles with `packageManager`, read from the release API
   (`gh api repos/pnpm/pnpm/releases/tags/v<version>`) and reproduced by
   downloading the assets.
