# Container base images

> The single source for WHY the four deployables run on the base they run on.
> The Dockerfiles point here instead of restating it, because the reasoning is
> identical for all four and a fact repeated four times is a fact that will be
> corrected in one of them.

**Owner:** Maintainers

---

## What the four images run on

All four deployables (`api`, `workers`, `admin`, `client`) share one production
stage:

```
FROM gcr.io/distroless/nodejs26-debian13@sha256:<digest> AS production
```

The build chain stays on Debian bookworm, `node:26.13.1-bookworm-slim`, pinned by
digest as well. That asymmetry is deliberate and is explained under §"The glibc
direction" below. The Node 26 line arrived on 2026-10-15, ahead of its LTS date
([ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md)); §"Moved to Node 26
on 2026-10-15" below holds the measurements. Both stages moved to 26.12.1, the
security release of 2026-10-21, on 2026-10-22 (§"Moved to Node 26.12.1 on
2026-10-22"), and to 26.13.1, the security release of 2026-11-11, on 2026-11-14
(§"Moved to Node 26.13.1 on 2026-11-14"). The production digest moved again on
2026-11-26, for Debian's `libzstd1` fix, with Node unchanged (§"Re-pinned on
2026-11-26: libzstd1 `1.5.7+dfsg-1+deb13u1`").

---

## Why distroless

No shell, no package manager, no `apt`. That is the point: the smallest thing
that can run a Node process is also the smallest thing an attacker can reach.

It has a cost that is easy to mistake for a limitation of your own permissions:
**you cannot patch a distroless image from inside it.** There is no `apt-get
upgrade` to run because there is no `apt` binary. When a system library in the
base carries a CVE, the usual moves are to wait for the vendor to rebuild, or to
move to a base generation that already carries the fix.

Copying a patched `.so` in alone is not a third option. Trivy reads
`var/lib/dpkg/status.d`, not the binaries, so the report would keep naming the
old version while the library on disk was new — trading an honest red for an
image whose own inventory lies. The third option is the whole Debian package:
its files and the `status.d` entry written from its own `control` and
`md5sums`, so the inventory names the version on disk. The images took that
option for `zlib1g` from 2026-11-07, while no digest held Debian's fix, to
2026-11-14, the day they moved to a digest that holds it: the first such digest,
`e2a8b92e` (Node 26.13.0), was uploaded on 2026-11-08T21:54:58Z
(§"zlib1g from Debian's archive on 2026-11-07").

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
(SMELL-207, plan row DEF-160, `docs/product/plan/chain.md`).

### zlib1g from Debian's archive on 2026-11-07

CVE-2026-85091 (HIGH, a heap buffer overflow in `gz_vacate()`) was in Trivy's
database by 2026-11-07, when it turned all four Container Security jobs red with
no change of ours. Debian fixes it, with CVE-2026-76844 and CVE-2026-27171, in
`zlib1g` `1:1.3.dfsg+really1.3.1-1+deb13u1`
([DSA-6613-1](https://security-tracker.debian.org/tracker/DSA-6613-1)). No digest
of the distroless image held that version: read on `linux/amd64`, both the pinned
`456bd22a` and the `latest` index of 21:03Z that day, `c952ca0a`, hold
`1:1.3.dfsg+really1.3.1-1+b1`. The Maintainer chose the fix on 2026-11-07 over a
second `.trivyignore` entry and over waiting for the rebuild.

A distroless image has no package manager, so all four Dockerfiles gained a stage,
`zlib-patched`, on `debian:trixie-slim@sha256:a72b4433…`. It downloaded the package
apt verifies from Debian's archive, refused a version below the fix, unpacked it to
`/out` and wrote the `status.d` entry from the package's own `control` and
`md5sums`, the format the image already holds. The production stage ran
`COPY --from=zlib-patched /out/ /` right after its `FROM`, before any `USER`.

The version was a floor rather than a pin on purpose. Debian's archive drops a
superseded security upload, so `zlib1g=<version>` would have stopped every image
build the day Debian published the next one, while the floor took that upload and
still refused anything older.

Measured on 2026-11-07 on a scratch build of the stage over `456bd22a`: the status
entry reads `1:1.3.dfsg+really1.3.1-1+deb13u1`; a recursive `diff` against the base
names only the `libz` files, the package's Debian changelog and its two `status.d`
files; and `/nodejs/bin/node` still runs v26.12.1 with its own zlib, gzipping and
hashing normally. No program in the image loads the replaced `libz`: `node` links
neither it nor `libcrypto`, the one library that does. Trivy runs in the Container
Security jobs of the pull request, which hold the verdict.

**Removed on 2026-11-14.** The stage's remove-when was a digest of the distroless
image holding that version or a later one, and the entry `zlib-stage-remove` of
`scripts/testing/maturity-watchlist.json` read the newest digest every Tuesday.
Read on 2026-11-14, the `latest` index `80631bd2`, uploaded on 2026-11-12T21:17:21Z,
holds `zlib1g` `1:1.3.dfsg+really1.3.1-1+deb13u1` in its own
`var/lib/dpkg/status.d/zlib1g`; the first digest that held it, `e2a8b92e`
(Node 26.13.0), had been uploaded on 2026-11-08T21:54:58Z, and 2026-11-14 is
the day the images moved to a digest that holds it. The stage and its `COPY` left all four Dockerfiles
with the move to that digest (§"Moved to Node 26.13.1 on 2026-11-14"), and the
watchlist entry left with them.

### Moved to Node 26.13.1 on 2026-11-14

Node 26.13.1, released on 2026-11-11 (`nodejs.org/dist/index.json` dates it
2026-11-10; the GitHub release was published at 2026-11-11T16:44:25Z), fixes
sixteen CVEs on the 26.x line
([release notes](https://github.com/nodejs/node/releases/tag/v26.13.1)): seven
High, with nine fixes between them, one a remotely reachable TLS server crash
(CVE-2026-126051); six Medium; and three Low.
[ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md) §"Revisit if" makes a
26.x security release a floor taken at once
([ADR-0036](../technical/ADR-0036-dependency-update-cadence.md)), so both stages
of all four Dockerfiles moved on 2026-11-14, inside the 7-day buffer (it matures
from 2026-11-18T16:44Z), by the Maintainer's decision of 2026-11-15:

| Stage      | Before                                          | After                                                                                                            |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| build      | `node:26.12.1-bookworm-slim@sha256:28147155…`   | `node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1`             |
| production | `distroless/nodejs26-debian13@sha256:456bd22a…` | `distroless/nodejs26-debian13@sha256:80631bd2f0e7ef192138a7409013b47d92fd11b8ff3bb35f5c0a65be3ecaea4c`, `latest` |

Both are multi-arch indexes, read on 2026-11-14 at 00:46Z. The `latest` tag of
`gcr.io/distroless/nodejs26-debian13` resolved to `80631bd2`, the newest index in
the repository's tag list, uploaded on 2026-11-12T21:17:21Z; the tag
`node:26.13.1-bookworm-slim` resolved to `5df79989`, pushed on
2026-11-11T19:26:58Z. The digests Dependabot proposed do not qualify: `e2a8b92e`
(#868 to #871, uploaded on 2026-11-08T21:54:58Z, holding the same `zlib1g`) runs
v26.13.0, and `88e48077` (#826, #829 to #831), a newer digest
of the `node:26.12.1-bookworm-slim` tag, runs v26.12.1.

Measured on 2026-11-14 from the `linux/amd64` image of each digest (production
manifest `7501d647…`, build manifest `18a166e2…`), by reading the image's own
`var/lib/dpkg/status.d` with `podman image mount` and running its `node`:

|                       | `456bd22a` (2026-10-22)                                                                                             | `80631bd2` (2026-11-14)                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| openssl               | `libssl3t64` 3.5.7-1~deb13u3                                                                                        | `libssl3t64` 3.5.7-1~deb13u3                               |
| glibc                 | `libc6` 2.41-12+deb13u4                                                                                             | `libc6` 2.41-12+deb13u4                                    |
| zlib                  | `zlib1g` 1:1.3.dfsg+really1.3.1-1+b1                                                                                | **`zlib1g` 1:1.3.dfsg+really1.3.1-1+deb13u1** (DSA-6613-1) |
| tzdata                | `tzdata` 2026c-0+deb13u1                                                                                            | `tzdata` **2026f-0+deb13u1**                               |
| node                  | v26.12.1 (undici 8.12.2)                                                                                            | **v26.13.1** (undici 8.12.4)                               |
| Trivy `HIGH,CRITICAL` | 2 (debian 13.7): `zlib1g` CVE-2026-76844 and CVE-2026-85091, both HIGH, fixed in `1:1.3.dfsg+really1.3.1-1+deb13u1` | 0 (debian 13.7)                                            |

The two `status.d` inventories differ in `zlib1g`, `tzdata` and `tzdata-legacy`
only, and the `node` of both reports OpenSSL 3.5.9. The build stage moved from
v26.12.1 to v26.13.1, kept glibc 2.36-9+deb12u14 and npm 11.20.0, and still ships
no corepack. Build and runtime run the same release, v26.13.1.

Trivy 0.74.0, with the gate's flags (`CRITICAL,HIGH`, exit code 1, table format,
the repository's `.trivyignore`) and its database of 2026-11-14T01:05:40Z,
produced the last row, over the `linux/amd64` image of each digest saved from
podman storage: exit 1 for `456bd22a`, exit 0 for `80631bd2`. The four images
built with `podman` from this change on 2026-11-14 each run `/nodejs/bin/node`
v26.13.1 as `nonroot` (uid 65532) and report `zlib1g`
`1:1.3.dfsg+really1.3.1-1+deb13u1` in their own `var/lib/dpkg/status.d/zlib1g`;
argon2 round-trips in the API image; the API and workers `CMD` entries resolve
their whole module graph and stop at the environment validation, which this
smoke does not satisfy; both portal images answer 200 on `/api/health` and `/`
(73096 bytes for `admin`, 112019 for `client`) and pass `podman healthcheck run`;
and the same Trivy, saved from each built image, exits 0 with no HIGH or
CRITICAL vulnerability in any of the four (`debian 13.7` and 767, 529, 25 and 25
`node-pkg` targets for `api`, `workers`, `admin` and `client`). The gate itself
is the `Container Security` job of the pull request, which runs
`aquasecurity/trivy-action` at the commit of its release v0.36.0, as
`production-ci.yml` pins it; this section records the local read.

### Re-pinned on 2026-11-26: libzstd1 `1.5.7+dfsg-1+deb13u1`

CVE-2026-124851 (HIGH, an information disclosure in Zstandard 1.5.1 to 1.5.7:
crafted compressed data exposes an internal buffer of 64 KiB, uninitialized
memory or literals of earlier decompressions on the same context, through the
decompressed output) reached `libzstd1` `1.5.7+dfsg-1`, the version inside
`80631bd2`. Debian fixes it in `1.5.7+dfsg-1+deb13u1`
([DSA-6657-1](https://security-tracker.debian.org/tracker/DSA-6657-1)). It failed
`Container Security` on all four services of pull request #996 on 2026-11-26
(run 45783663707), as each image's only HIGH or CRITICAL finding, in a change
that touches no Dockerfile. Only the production stage moves:

| Stage      | Before                                          | After                                                                                                            |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| production | `distroless/nodejs26-debian13@sha256:80631bd2…` | `distroless/nodejs26-debian13@sha256:13e3ac17e2911d238622fea7808a7a161ba6b33a41e542ded6e399387e1dbc84`, `latest` |

It is a multi-arch index, an OCI image index of four platforms, read on
2026-11-26 at 08:56Z: the registry's `Docker-Content-Digest` for `latest` and the
sha256 of the index's own bytes are both `13e3ac17`, uploaded on
2026-11-25T20:54:24Z, the newest index of the image in the repository's tag list
(its `nonroot` and `debug` variants are indexes of their own). The digest
Dependabot proposed in #989 to #992, `b462e87a`, uploaded on
2026-11-22T21:11:01Z, is the one index of the image between the two, and it
cannot hold the fix: the trixie-security entry of `1.5.7+dfsg-1+deb13u1` in the
new image's own `libzstd1` changelog is dated 2026-11-24T17:43:52Z, two days after
that upload. So this change takes the newer `latest` into all four services at
once.

Measured on 2026-11-26 from the `linux/amd64` image of each digest (production
manifest `521609db…`), by reading the image's own `var/lib/dpkg/status.d` from
`podman create` and `podman export` and running its `node` with
`podman run --network=none`:

|                       | `80631bd2` (2026-11-14)                                                                         | `13e3ac17` (2026-11-26)                          |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| debian                | 13.7                                                                                            | **13.8**                                         |
| openssl               | `libssl3t64` 3.5.7-1~deb13u3                                                                    | `libssl3t64` **3.5.9-1~deb13u1**                 |
| glibc                 | `libc6` 2.41-12+deb13u4                                                                         | `libc6` **2.41-12+deb13u5**                      |
| zstd                  | `libzstd1` 1.5.7+dfsg-1                                                                         | **`libzstd1` 1.5.7+dfsg-1+deb13u1** (DSA-6657-1) |
| node                  | v26.13.1                                                                                        | v26.13.1                                         |
| Trivy `HIGH,CRITICAL` | 1 in each image of run 45783663707: `libzstd1` CVE-2026-124851, fixed in `1.5.7+dfsg-1+deb13u1` | not run locally; the pull request's jobs hold it |

The two `status.d` inventories differ in `base-files`, `libc6`, `libssl3t64` and
`libzstd1` only, and the two file trees, which hold the same 1762 paths, differ in
those packages' libraries, changelogs and status entries and in
`etc/debian_version`. Debian's 13.8 point release brought `libc6` deb13u5, glibc's
stable-branch update with fixes for fourteen CVEs, and `libssl3t64` 3.5.9;
`libzstd1` comes from trixie-security. `/nodejs/bin/node` is the same file in both
(one sha256), and the image configuration (entrypoint, user, environment) is the
same, so the readings of this `node` elsewhere in this document and in
`docs/security/DEPENDENCY_AUDIT_RECORD.md` hold for the new digest. The
`libssl3t64` move fixes neither ignored OpenSSL entry: Debian's tracker, read on
2026-11-26, lists trixie's `3.5.9-1~deb13u1` vulnerable to both, so they stay in
`.trivyignore` (§"Ignored image CVEs" of the audit record).

No image was built from this change and Trivy was not run on the host. The gate
is the `Container Security` job of the pull request, which builds and scans the
four images; this section records the local read.

### pnpm in the build stage

Node 26 ships no corepack: it is "no longer distributed as of Node.js v25.0.0"
(nodejs/node#61207), and `node:26.13.1-bookworm-slim` carries `node`, `npm` and
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
runs lifecycle scripts with the `node` on `PATH`, the image's 26.13.1, and
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
`node:26.13.1-bookworm-slim@sha256:…`, so Dependabot tracks both `FROM` lines of
every Dockerfile.

---

## The Dockerfile frontend

Line 1 of each of the four Dockerfiles names the BuildKit frontend that parses
the rest of the file:

```
# syntax=docker/dockerfile:1.29.0@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183
```

The frontend is an image BuildKit pulls before it reads a line of the build, so
a tag alone lets the registry decide which bytes build every image. The
directive takes a tag and a digest
([Docker: custom Dockerfile syntax](https://docs.docker.com/build/buildkit/frontend/)),
and with both, the digest decides. `1.29.0` is the latest stable release on
2026-11-28 (published 2026-11-11), and the digest is that of its
multi-platform index, read twice that day and alike in both: from Docker Hub's
tag API (`hub.docker.com/v2/namespaces/docker/repositories/dockerfile/tags`),
where `1.29.0`, `1.29`, `1` and `latest` share it, and from the
`Docker-Content-Digest` header the registry returns for
`registry-1.docker.io/v2/docker/dockerfile/manifests/1.29.0`. The `-labs` tags
are a separate channel of experimental syntax and are not taken.

Dependabot does not move this line: its Docker parser reads `FROM` lines alone
(`docker/lib/dependabot/docker/file_parser.rb` of dependabot-core, read on
2026-11-28). It moves by item 7 of §"How to extend", and
`apps/api/tests/unit/scripts/imageSupply.test.ts` holds the four lines to one
version and one digest.

---

## The glibc direction

`argon2` ships a prebuilt native binary that must match the runtime ABI. The
build chain stays on `node:26.13.1-bookworm-slim` (glibc 2.36) while the runtime
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

**And the Node the images run is held to its own release line.** Trivy never
reads the `node` executable, so each leg of `Container Security` reports the
`node --version` its image prints, and the `Node Runtime Advisory` job runs
`scripts/testing/node-runtime-advisory-gate.mjs` on the four versions: it fails
when `nodejs.org/dist/index.json` lists a later release of that major line with
`security: true`, naming the release to raise both stages to. It is skipped
when `Container Security` was skipped, since no image was built. No ruleset
requires that job and no other job needs it, so its red blocks no merge, no
scan and no push, and every run judges the images again. It exists for two cases
the team cannot repair at once: the index is unreachable after three attempts,
or Node has published a security release of the images' line that the distroless base does
not ship yet, which it followed by about two days for v26.13.1 (dated
2026-11-10 by the index; the digest the images took for it, `80631bd2`, was uploaded on
2026-11-12, §"Moved to Node 26.13.1 on 2026-11-14"). In the first case, re-run the job once nodejs.org answers; in the
second, raise the build stage to the release and wait for, or pin, the distroless
digest that ships it, by items 2 and 3 of §"How to extend" below, the way the
move of 2026-11-14 did. Its other red cases are the team's to repair: an image
not checked, whose leg's log says why no version came; a version the gate
refuses as not a stable vX.Y.Z, which points at the image's Node base; and a
failure of the gate itself, code 4, whose lines carry the error and its trace
and point at the gate's script.

---

## When CI runs the images

**Decided on 2026-10-05 by the Maintainer (option A).** `production-ci.yml` runs
on pull requests against `main`, `omni-post-cc`, `feature/**` and `workstream/**`,
the same list as `ci.yml`, so every stacked pull request runs the whole workflow,
`Container Security` included. #419 delivered it (merge `7d73b00d`), the pull
request that brought `production-ci.yml` to the branch list of `ci.yml`.

- **Cost:** four image builds plus Trivy on every push of a stacked pull
  request, with the GHA cache and a 20-minute timeout per image.
- **Why:** the chain gets back the container signal, whose absence let the six
  defects of the image repair (landed with #304, merge `9e5175e4`, on
  2026-09-25) get this far; and every stacked pull request carries the required
  check `Test and Build`, which a pull request against a `workstream/*` parent
  did not have (measured on 2026-10-05 on #410, which stayed `BLOCKED` after its
  retarget).
- **Rejected:** the two options measured beside it, a workflow of its own with a
  `paths` filter, and keeping the validation local.

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
   `docs/security/DEPENDENCY_AUDIT_RECORD.md` §"Audited audit-ignores" and its projection
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
7. **Moving the Dockerfile frontend** → line 1 of all four Dockerfiles moves in
   one change, to the latest stable `docker/dockerfile` release, never a `-labs`
   tag, with the digest of its index read twice and alike: from Docker Hub's tag
   API and from the registry's `Docker-Content-Digest` header, as
   §"The Dockerfile frontend" did.
