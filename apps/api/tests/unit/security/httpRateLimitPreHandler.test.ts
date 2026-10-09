/**
 * @file httpRateLimitPreHandler.test.ts
 * @description Unit tests for the HTTP rate-limit preHandlers: path→rule
 *              matching, header emission, 429 on denial, fail-open on a
 *              limiter error, the bucket key and rule that every spelling of
 *              one request reaching one handler must share, and the namespaced
 *              handler's per-IP key and identical responses.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { RateLimiterPort, RateLimitDecision, RateLimitOptions } from "@ports/core";
import {
  createHttpRateLimitPreHandler,
  createNamespacedRateLimitPreHandler,
  RateLimitConfigs,
  STANDARD_ROUTE_RULES,
  EXPENSIVE_ENDPOINT_RULES,
} from "../../../src/security/httpRateLimitPreHandler.js";

interface FakeReqOptions {
  readonly xff?: string;
  readonly socket?: string;
  /** The route pattern the router matched; defaults to `url`, and `null` is a request no route matched. */
  readonly route?: string | null;
  /** The route parameters Fastify parsed for the request. */
  readonly params?: Readonly<Record<string, unknown>>;
}

function fakeReq(url: string, opts: FakeReqOptions = {}): FastifyRequest {
  const socket = opts.socket ?? "9.9.9.9";
  const xff = opts.xff ?? "9.9.9.9";
  const route = opts.route === undefined ? url : opts.route;
  return {
    url,
    ip: socket,
    headers: { "x-forwarded-for": xff },
    socket: { remoteAddress: socket },
    routeOptions: { url: route ?? undefined },
    params: opts.params ?? {},
  } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & {
  headers: Record<string, string>;
  statusCode?: number;
  body?: unknown;
} {
  const reply = {
    headers: {} as Record<string, string>,
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    header(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
    code(n: number) {
      this.statusCode = n;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return reply as unknown as FastifyReply & {
    headers: Record<string, string>;
    statusCode?: number;
    body?: unknown;
  };
}

function limiterReturning(decision: RateLimitDecision): {
  port: RateLimiterPort;
  calls: Array<{ key: string; opts?: RateLimitOptions }>;
} {
  const calls: Array<{ key: string; opts?: RateLimitOptions }> = [];
  const port: RateLimiterPort = {
    tryConsume: vi.fn(async (key: string, opts?: RateLimitOptions) => {
      calls.push({ key, ...(opts !== undefined && { opts }) });
      return decision;
    }),
  };
  return { port, calls };
}

const ALLOW: RateLimitDecision = { allowed: true, remaining: 42, resetAtMs: 1_000_000 };

describe("createHttpRateLimitPreHandler", () => {
  it("applies the default config for an unmatched route", async () => {
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES],
    });

    await handler(fakeReq("/posts"), fakeReply());

    expect(calls[0]?.opts?.capacity).toBe(RateLimitConfigs.STANDARD.maxRequests);
    expect(calls[0]?.opts?.refillWindowMs).toBe(RateLimitConfigs.STANDARD.windowMs);
    expect(calls[0]?.key).toBe("9.9.9.9:/posts");
  });

  it("applies the matched rule config (first prefix match wins)", async () => {
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES],
    });

    // /analytics/cross-platform is CRITICAL (5/min) in the expensive rules.
    await handler(fakeReq("/analytics/cross-platform"), fakeReply());

    expect(calls[0]?.opts?.capacity).toBe(RateLimitConfigs.CRITICAL_EXPENSIVE.maxRequests);
  });

  it("applies the AUTH preset (5 / 15 min) to /auth/login and /auth/refresh", async () => {
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES],
    });

    await handler(fakeReq("/auth/login"), fakeReply());
    await handler(fakeReq("/auth/refresh"), fakeReply());

    expect(calls[0]?.opts?.capacity).toBe(RateLimitConfigs.AUTH.maxRequests);
    expect(calls[0]?.opts?.refillWindowMs).toBe(RateLimitConfigs.AUTH.windowMs);
    expect(calls[1]?.opts?.capacity).toBe(RateLimitConfigs.AUTH.maxRequests);
  });

  it("applies the AUTH preset (5 / 15 min) to the client-portal credential paths, NOT the STANDARD 100/min", async () => {
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES],
    });

    // The Next client portal relays these two paths to the backend; without an
    // explicit AUTH rule they fall through to STANDARD (100/min) and client
    // login stays brute-forceable.
    await handler(fakeReq("/auth/customer/login"), fakeReply());
    await handler(fakeReq("/auth/customer/refresh"), fakeReply());

    // /auth/customer/login → AUTH cap (5 / 900_000 ms), not STANDARD.
    expect(calls[0]?.opts?.capacity).toBe(RateLimitConfigs.AUTH.maxRequests);
    expect(calls[0]?.opts?.capacity).toBe(5);
    expect(calls[0]?.opts?.refillWindowMs).toBe(RateLimitConfigs.AUTH.windowMs);
    expect(calls[0]?.opts?.refillWindowMs).toBe(900_000);
    expect(calls[0]?.opts?.capacity).not.toBe(RateLimitConfigs.STANDARD.maxRequests);
    // /auth/customer/refresh → AUTH cap too (aligned with /auth/refresh).
    expect(calls[1]?.opts?.capacity).toBe(RateLimitConfigs.AUTH.maxRequests);
    expect(calls[1]?.opts?.refillWindowMs).toBe(RateLimitConfigs.AUTH.windowMs);
  });

  it("no longer carries the dead /accounts$ rule (would never prefix-match)", () => {
    expect(STANDARD_ROUTE_RULES.some((r) => r.path.includes("$"))).toBe(false);
  });

  it("sets rate-limit headers on an allowed request", async () => {
    const { port } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [],
    });
    const reply = fakeReply();

    await handler(fakeReq("/posts"), reply);

    expect(reply.headers["X-RateLimit-Remaining"]).toBe("42");
    expect(reply.headers["X-RateLimit-Reset"]).toBe("1000000");
    expect(reply.statusCode).toBeUndefined();
  });

  it("responds 429 with Retry-After when denied", async () => {
    const { port } = limiterReturning({
      allowed: false,
      remaining: 0,
      resetAtMs: 2_000_000,
      retryAfterMs: 30_000,
    });
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STRICT,
      rules: [],
    });
    const reply = fakeReply();

    await handler(fakeReq("/publish/x"), reply);

    expect(reply.statusCode).toBe(429);
    expect(reply.headers["Retry-After"]).toBe("30");
    expect((reply.body as { error: string }).error).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("keys by the resolver's IP, not the leftmost X-Forwarded-For entry", async () => {
    // Test env runs the default TRUSTED_PROXY_MODE=socket-only, so resolveClientIp
    // returns the socket peer — proving the pre-handler no longer trusts the
    // spoofable leftmost XFF entry that the old `clientIp()` used.
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [],
    });

    await handler(fakeReq("/posts", { socket: "10.0.0.1", xff: "1.1.1.1" }), fakeReply());

    expect(calls[0]?.key).toBe("10.0.0.1:/posts");
  });

  it("maps a rotating leftmost X-Forwarded-For to the SAME bucket (spoof-resistance)", async () => {
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [],
    });

    await handler(fakeReq("/posts", { socket: "10.0.0.1", xff: "1.1.1.1, 8.8.8.8" }), fakeReply());
    await handler(fakeReq("/posts", { socket: "10.0.0.1", xff: "2.2.2.2, 8.8.8.8" }), fakeReply());

    expect(calls[0]?.key).toBe(calls[1]?.key);
  });

  it("fails open (no 429) when the limiter throws", async () => {
    const port: RateLimiterPort = {
      tryConsume: vi.fn(async () => {
        throw new Error("redis down");
      }),
    };
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [],
    });
    const reply = fakeReply();

    await handler(fakeReq("/posts"), reply);

    expect(reply.statusCode).toBeUndefined();
    expect(reply.body).toBeUndefined();
  });

  it("returns the route's bucket and rule when the request target is in absolute form", async () => {
    // Node hands an absolute-form target (`POST http://host/auth/login`) to the
    // router verbatim, and the router still reaches the `/auth/login` handler.
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES],
    });

    await handler(
      fakeReq("http://api.example:3000/auth/login?n=1", { route: "/auth/login" }),
      fakeReply()
    );

    expect(calls[0]?.key).toBe("9.9.9.9:/auth/login");
    expect(calls[0]?.opts?.capacity).toBe(RateLimitConfigs.AUTH.maxRequests);
  });

  it("returns the route's bucket when the request target carries a fragment", async () => {
    // A raw client can send `#…` in the target; the router ignores it.
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES],
    });

    await handler(fakeReq("/auth/login#n=1", { route: "/auth/login" }), fakeReply());

    expect(calls[0]?.key).toBe("9.9.9.9:/auth/login");
    expect(calls[0]?.opts?.capacity).toBe(RateLimitConfigs.AUTH.maxRequests);
  });

  it("returns the parsed parameter values in the key, numeric and wildcard ones included", async () => {
    // A params schema can coerce a value to a number; the wildcard value sits under `*`.
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [],
    });

    await handler(fakeReq("/posts/007", { route: "/posts/:id", params: { id: 7 } }), fakeReply());
    await handler(
      fakeReq("/files/a/b.png", { route: "/files/*", params: { "*": "a/b.png" } }),
      fakeReply()
    );

    expect(calls[0]?.key).toBe("9.9.9.9:/posts/7");
    expect(calls[1]?.key).toBe("9.9.9.9:/files/a/b.png");
  });

  it("returns the route-wide bucket when a parameter has no scalar value", async () => {
    // Falling back to the token widens the bucket to the route; it never splits it.
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [],
    });

    await handler(fakeReq("/posts/x", { route: "/posts/:id", params: {} }), fakeReply());
    await handler(
      fakeReq("/posts/y", { route: "/posts/:id", params: { id: { nested: "y" } } }),
      fakeReply()
    );

    expect(calls[0]?.key).toBe("9.9.9.9:/posts/:id");
    expect(calls[1]?.key).toBe("9.9.9.9:/posts/:id");
  });
});

describe("createHttpRateLimitPreHandler behind Fastify's router", () => {
  let app: FastifyInstance;
  let calls: Array<{ key: string; opts?: RateLimitOptions }>;

  beforeEach(async () => {
    const limiter = limiterReturning(ALLOW);
    calls = limiter.calls;
    app = Fastify({ logger: false });
    app.addHook(
      "preHandler",
      createHttpRateLimitPreHandler(limiter.port, {
        defaultConfig: RateLimitConfigs.STANDARD,
        rules: [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES],
      })
    );
    app.post("/auth/login", async () => ({ ok: true }));
    app.get("/auth/:provider", async () => ({ ok: true }));
    app.get("/health", async () => ({ ok: true }));
    app.get("/posts/:id", async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns one /auth/login bucket under the AUTH rule when each attempt adds a query string", async () => {
    for (const url of ["/auth/login", "/auth/login?n=1", "/auth/login?n=2", "/auth/login?"]) {
      const response = await app.inject({ method: "POST", url, payload: {} });
      expect(response.statusCode).toBe(200);
    }

    expect(calls.map((c) => c.key)).toEqual(Array(4).fill("127.0.0.1:/auth/login"));
    for (const call of calls) {
      expect(call.opts?.capacity).toBe(RateLimitConfigs.AUTH.maxRequests);
      expect(call.opts?.refillWindowMs).toBe(RateLimitConfigs.AUTH.windowMs);
    }
  });

  it("returns one /auth/login bucket under the AUTH rule when the path is percent-encoded", async () => {
    for (const url of ["/auth/l%6Fgin", "/%61uth/login", "/auth/%6C%6F%67%69%6E"]) {
      const response = await app.inject({ method: "POST", url, payload: {} });
      expect(response.statusCode).toBe(200);
    }

    expect(calls.map((c) => c.key)).toEqual(Array(3).fill("127.0.0.1:/auth/login"));
    for (const call of calls) {
      expect(call.opts?.capacity).toBe(RateLimitConfigs.AUTH.maxRequests);
    }
  });

  it("returns the HEALTH rule and the /health bucket when /health carries a query string", async () => {
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health?probe=1" });

    expect(calls[1]?.key).toBe(calls[0]?.key);
    expect(calls[1]?.opts?.capacity).toBe(RateLimitConfigs.HEALTH.maxRequests);
  });

  it("returns one bucket per resource, whichever spelling the path uses", async () => {
    for (const url of ["/posts/123", "/posts/1%32%33", "/posts/123?view=full", "/posts/456"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
    }

    expect(calls.map((c) => c.key)).toEqual([
      "127.0.0.1:/posts/123",
      "127.0.0.1:/posts/123",
      "127.0.0.1:/posts/123",
      "127.0.0.1:/posts/456",
    ]);
  });

  it("returns the rule of the route pattern, whatever a parameter value spells", async () => {
    // `GET /auth/login` reaches an OAuth start route `/auth/:provider`, not the
    // credential endpoint, so the AUTH rule written for `/auth/login` does not apply.
    const response = await app.inject({ method: "GET", url: "/auth/login" });

    expect(response.statusCode).toBe(200);
    expect(calls[0]?.key).toBe("127.0.0.1:/auth/login");
    expect(calls[0]?.opts?.capacity).toBe(RateLimitConfigs.STANDARD.maxRequests);
  });

  it("returns one per-IP bucket under the default rule for every URL no route matches", async () => {
    for (const url of ["/nope", "/nope?n=1", "/auth/login/", "//auth/login"]) {
      const response = await app.inject({ method: "POST", url, payload: {} });
      expect(response.statusCode).toBe(404);
    }

    expect(calls.map((c) => c.key)).toEqual(Array(4).fill("127.0.0.1:!unrouted"));
    for (const call of calls) {
      expect(call.opts?.capacity).toBe(RateLimitConfigs.STANDARD.maxRequests);
    }
  });
});

describe("createNamespacedRateLimitPreHandler", () => {
  it("returns one namespace bucket per client IP, whatever URL or route the request names", async () => {
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createNamespacedRateLimitPreHandler(
      port,
      "redirect",
      RateLimitConfigs.REDIRECT
    );

    await handler(
      fakeReq("/r/abc", { route: "/r/:shortCode", params: { shortCode: "abc" } }),
      fakeReply()
    );
    await handler(
      fakeReq("/r/xyz?u=1", { route: "/r/:shortCode", params: { shortCode: "xyz" } }),
      fakeReply()
    );

    expect(calls).toEqual([
      {
        key: "redirect:9.9.9.9",
        opts: {
          capacity: RateLimitConfigs.REDIRECT.maxRequests,
          refillWindowMs: RateLimitConfigs.REDIRECT.windowMs,
        },
      },
      {
        key: "redirect:9.9.9.9",
        opts: {
          capacity: RateLimitConfigs.REDIRECT.maxRequests,
          refillWindowMs: RateLimitConfigs.REDIRECT.windowMs,
        },
      },
    ]);
  });
});

const DENY: RateLimitDecision = {
  allowed: false,
  remaining: 0,
  resetAtMs: 2_000_000,
  retryAfterMs: 30_500,
};

const DENIED_BODY = {
  ok: false,
  error: "RATE_LIMIT_EXCEEDED",
  message: "Too many requests. Please try again later.",
  retryAfter: new Date(2_000_000).toISOString(),
};

type PreHandlerFactory = (
  port: RateLimiterPort
) => ReturnType<typeof createHttpRateLimitPreHandler>;

const PRE_HANDLER_FACTORIES: ReadonlyArray<readonly [string, PreHandlerFactory]> = [
  [
    "createHttpRateLimitPreHandler",
    (port) =>
      createHttpRateLimitPreHandler(port, { defaultConfig: RateLimitConfigs.STANDARD, rules: [] }),
  ],
  [
    "createNamespacedRateLimitPreHandler",
    (port) => createNamespacedRateLimitPreHandler(port, "redirect", RateLimitConfigs.REDIRECT),
  ],
];

describe.each(PRE_HANDLER_FACTORIES)("%s decision responses", (_name, build) => {
  it("returns undefined with the remaining and reset headers when the request is allowed", async () => {
    const { port } = limiterReturning(ALLOW);
    const reply = fakeReply();

    const result = await build(port)(fakeReq("/posts"), reply);

    expect(result).toBeUndefined();
    expect(reply.headers).toEqual({
      "X-RateLimit-Remaining": "42",
      "X-RateLimit-Reset": "1000000",
    });
    expect(reply.statusCode).toBeUndefined();
    expect(reply.body).toBeUndefined();
  });

  it("returns a 429 with Retry-After rounded up to whole seconds and the rate-limit body when denied", async () => {
    const { port } = limiterReturning(DENY);
    const reply = fakeReply();

    const result = await build(port)(fakeReq("/posts"), reply);

    expect(result).toBe(reply);
    expect(reply.statusCode).toBe(429);
    expect(reply.headers).toEqual({
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": "2000000",
      "Retry-After": "31",
    });
    expect(reply.body).toEqual(DENIED_BODY);
  });

  it("returns Retry-After 0 when a denial carries no retry delay", async () => {
    const { retryAfterMs: _retryAfterMs, ...denyWithoutDelay } = DENY;
    const { port } = limiterReturning(denyWithoutDelay);
    const reply = fakeReply();

    await build(port)(fakeReq("/posts"), reply);

    expect(reply.statusCode).toBe(429);
    expect(reply.headers["Retry-After"]).toBe("0");
  });

  it("returns undefined with no header and no response when the limiter throws", async () => {
    const port: RateLimiterPort = {
      tryConsume: vi.fn(async () => {
        throw new Error("redis down");
      }),
    };
    const reply = fakeReply();

    const result = await build(port)(fakeReq("/posts"), reply);

    expect(result).toBeUndefined();
    expect(reply.headers).toEqual({});
    expect(reply.statusCode).toBeUndefined();
    expect(reply.body).toBeUndefined();
  });
});
