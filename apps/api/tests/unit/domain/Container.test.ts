/**
 * Infrastructure Layer - Container Unit Tests
 *
 * Part of Sprint 7: DDD Architecture Implementation
 * Tests for the dependency injection container.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  Container,
  TOKENS,
  getContainer,
  resetContainer,
  createTestContainer,
} from "../../../src/infrastructure/container/index.js";

describe("Container", { concurrency: 1 }, () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe("register and resolve", () => {
    it("should register and resolve a service", () => {
      const mockService = { doSomething: () => "done" };

      container.register(TOKENS.PostRepository, () => mockService);

      const resolved = container.resolve(TOKENS.PostRepository);
      assert.equal(resolved, mockService);
    });

    it("should create singleton by default", () => {
      let callCount = 0;
      container.register(TOKENS.PostRepository, () => {
        callCount++;
        return { id: callCount };
      });

      const first = container.resolve(TOKENS.PostRepository);
      const second = container.resolve(TOKENS.PostRepository);

      assert.equal(callCount, 1, "Factory should only be called once");
      assert.equal(first, second, "Should return same instance");
    });

    it("should create transient when configured", () => {
      let callCount = 0;
      container.register(
        TOKENS.PostRepository,
        () => {
          callCount++;
          return { id: callCount };
        },
        false // transient
      );

      const first = container.resolve(TOKENS.PostRepository);
      const second = container.resolve(TOKENS.PostRepository);

      assert.equal(callCount, 2, "Factory should be called twice");
      assert.notEqual(first, second, "Should return different instances");
    });

    it("should throw error for unregistered service", () => {
      assert.throws(
        () => container.resolve(Symbol.for("UnknownService")),
        /Service not registered/
      );
    });
  });

  describe("registerInstance", () => {
    it("should register an existing instance", () => {
      const instance = { name: "test" };

      container.registerInstance(TOKENS.PostRepository, instance);

      const resolved = container.resolve(TOKENS.PostRepository);
      assert.equal(resolved, instance);
    });

    it("should always return same instance", () => {
      const instance = { name: "test" };

      container.registerInstance(TOKENS.PostRepository, instance);

      const first = container.resolve(TOKENS.PostRepository);
      const second = container.resolve(TOKENS.PostRepository);

      assert.equal(first, instance);
      assert.equal(second, instance);
    });
  });

  describe("tryResolve", () => {
    it("should return service if registered", () => {
      const service = { id: 1 };
      container.register(TOKENS.PostRepository, () => service);

      const result = container.tryResolve(TOKENS.PostRepository);
      assert.equal(result, service);
    });

    it("should return undefined if not registered", () => {
      const result = container.tryResolve(Symbol.for("Unknown"));
      assert.equal(result, undefined);
    });
  });

  describe("has", () => {
    it("should return true for registered service", () => {
      container.register(TOKENS.PostRepository, () => ({}));

      assert.ok(container.has(TOKENS.PostRepository));
    });

    it("should return false for unregistered service", () => {
      assert.ok(!container.has(Symbol.for("Unknown")));
    });
  });

  describe("createChild", () => {
    it("should create child that inherits from parent", () => {
      const parentService = { id: "parent" };
      container.register(TOKENS.PostRepository, () => parentService);

      const child = container.createChild();
      const resolved = child.resolve(TOKENS.PostRepository);

      assert.equal(resolved, parentService);
    });

    it("should allow child to override parent", () => {
      const parentService = { id: "parent" };
      const childService = { id: "child" };

      container.register(TOKENS.PostRepository, () => parentService);

      const child = container.createChild();
      child.register(TOKENS.PostRepository, () => childService);

      assert.equal(container.resolve(TOKENS.PostRepository), parentService);
      assert.equal(child.resolve(TOKENS.PostRepository), childService);
    });

    it("should check parent for has()", () => {
      container.register(TOKENS.PostRepository, () => ({}));

      const child = container.createChild();

      assert.ok(child.has(TOKENS.PostRepository));
    });
  });

  describe("clear", () => {
    it("should remove all registrations", () => {
      container.register(TOKENS.PostRepository, () => ({}));
      container.register(TOKENS.EventDispatcher, () => ({}));

      container.clear();

      assert.ok(!container.has(TOKENS.PostRepository));
      assert.ok(!container.has(TOKENS.EventDispatcher));
    });
  });

  describe("getRegisteredTokens", () => {
    it("should return all registered tokens", () => {
      container.register(TOKENS.PostRepository, () => ({}));
      container.register(TOKENS.EventDispatcher, () => ({}));

      const tokens = container.getRegisteredTokens();

      assert.ok(tokens.includes(TOKENS.PostRepository));
      assert.ok(tokens.includes(TOKENS.EventDispatcher));
      assert.equal(tokens.length, 2);
    });

    it("should include parent tokens", () => {
      container.register(TOKENS.PostRepository, () => ({}));

      const child = container.createChild();
      child.register(TOKENS.EventDispatcher, () => ({}));

      const tokens = child.getRegisteredTokens();

      assert.ok(tokens.includes(TOKENS.PostRepository));
      assert.ok(tokens.includes(TOKENS.EventDispatcher));
    });
  });

  describe("resetSingletons", () => {
    it("should clear singleton instances", () => {
      let callCount = 0;
      container.register(TOKENS.PostRepository, () => {
        callCount++;
        return { id: callCount };
      });

      const first = container.resolve(TOKENS.PostRepository);
      assert.equal((first as { id: number }).id, 1);

      container.resetSingletons();

      const second = container.resolve(TOKENS.PostRepository);
      assert.equal((second as { id: number }).id, 2);
    });
  });
});

describe("Global Container", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetContainer();
  });

  describe("getContainer", () => {
    it("should return same container instance", () => {
      const first = getContainer();
      const second = getContainer();

      assert.equal(first, second);
    });
  });

  describe("resetContainer", () => {
    it("should create new container after reset", () => {
      const first = getContainer();
      first.register(TOKENS.PostRepository, () => ({}));

      resetContainer();

      const second = getContainer();
      assert.ok(!second.has(TOKENS.PostRepository));
    });
  });
});

describe("createTestContainer", { concurrency: 1 }, () => {
  it("should create container with EventDispatcher by default", () => {
    const container = createTestContainer();

    assert.ok(container.has(TOKENS.EventDispatcher));
  });

  it("should apply symbol overrides", () => {
    const mockRepo = { id: "mock" };
    const overrides: Record<symbol, unknown> = {};
    overrides[TOKENS.PostRepository] = mockRepo;

    const container = createTestContainer(overrides);

    const resolved = container.resolve(TOKENS.PostRepository);
    assert.equal(resolved, mockRepo);
  });
});
