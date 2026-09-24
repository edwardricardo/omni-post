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
FROM gcr.io/distroless/nodejs24-debian13@sha256:<digest> AS production
```

The build chain stays on `node:24-bookworm-slim`. That asymmetry is deliberate
and is explained under §"The glibc direction" below.

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

---

## The glibc direction

`argon2` ships a prebuilt native binary that must match the runtime ABI. The
build chain stays on `node:24-bookworm-slim` (glibc 2.36) while the runtime is
trixie (glibc 2.41).

That is the **safe** direction: glibc is forward-compatible, so a binary built
against 2.36 runs on 2.41. The reverse would not hold. OpenSSL keeps the
`libssl.so.3` soname across the whole 3.x series, so dynamic linking still
resolves against 3.5.

**This is an argument, not a measurement**, and the distinction is load-bearing
here: nothing in CI runs the built container. See §"What is not verified".

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
2. **Re-pinning the digest** → prefer letting Dependabot open the PR. Pin by
   hand only to move generations, and say why here.
3. **A base CVE with no fix in the current generation** → the choice is wait,
   move generation, or accept. Accepting goes through
   `docs/security/SECURITY_CANON.md` §"Audited audit-ignores" and its projection
   in `.trivyignore`, never a silent suppression.
