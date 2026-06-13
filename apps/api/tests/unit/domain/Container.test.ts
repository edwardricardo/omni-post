/**
 * Infrastructure Layer - Container Unit Tests
 *
 * Tests for the dependency injection container.
 *
 * @file Container.test.ts
 * @description Tests for Container
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect } from "vitest";
import {
  Container,
  TOKENS,
  getContainer,
  resetContainer,
  createTestContainer,
} from "../../../src/infrastructure/container/index.js";

describe("Container", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe("register and resolve", () => {
    it("should register and resolve a service", () => {
      const mockService = { doSomething: () => "done" };

      container.register(TOKENS.PostRepository, () => mockService);

      const resolved = container.resolve(TOKENS.PostRepository);
      expect(resolved).toBe(mockService);
    });

    it("should create singleton by default", () => {
      let callCount = 0;
      container.register(TOKENS.PostRepository, () => {
        callCount++;
        return { id: callCount };
      });

      const first = container.resolve(TOKENS.PostRepository);
      const second = container.resolve(TOKENS.PostRepository);

      expect(callCount).toBe(1);
      expect(first).toBe(second);
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

      expect(callCount).toBe(2);
      expect(first).not.toBe(second);
    });

    it("should throw error for unregistered service", () => {
      expect(() => container.resolve(Symbol.for("UnknownService"))).toThrow(
        /Service not registered/
      );
    });
  });

  describe("registerInstance", () => {
    it("should register an existing instance", () => {
      const instance = { name: "test" };

      container.registerInstance(TOKENS.PostRepository, instance);

      const resolved = container.resolve(TOKENS.PostRepository);
      expect(resolved).toBe(instance);
    });

    it("should always return same instance", () => {
      const instance = { name: "test" };

      container.registerInstance(TOKENS.PostRepository, instance);

      const first = container.resolve(TOKENS.PostRepository);
      const second = container.resolve(TOKENS.PostRepository);

      expect(first).toBe(instance);
      expect(second).toBe(instance);
    });
  });

  describe("tryResolve", () => {
    it("should return service if registered", () => {
      const service = { id: 1 };
      container.register(TOKENS.PostRepository, () => service);

      const result = container.tryResolve(TOKENS.PostRepository);
      expect(result).toBe(service);
    });

    it("should return undefined if not registered", () => {
      const result = container.tryResolve(Symbol.for("Unknown"));
      expect(result).toBe(undefined);
    });
  });

  describe("has", () => {
    it("should return true for registered service", () => {
      container.register(TOKENS.PostRepository, () => ({}));

      expect(container.has(TOKENS.PostRepository)).toBeTruthy();
    });

    it("should return false for unregistered service", () => {
      expect(container.has(Symbol.for("Unknown"))).toBeFalsy();
    });
  });

  describe("createChild", () => {
    it("should create child that inherits from parent", () => {
      const parentService = { id: "parent" };
      container.register(TOKENS.PostRepository, () => parentService);

      const child = container.createChild();
      const resolved = child.resolve(TOKENS.PostRepository);

      expect(resolved).toBe(parentService);
    });

    it("should allow child to override parent", () => {
      const parentService = { id: "parent" };
      const childService = { id: "child" };

      container.register(TOKENS.PostRepository, () => parentService);

      const child = container.createChild();
      child.register(TOKENS.PostRepository, () => childService);

      expect(container.resolve(TOKENS.PostRepository)).toBe(parentService);
      expect(child.resolve(TOKENS.PostRepository)).toBe(childService);
    });

    it("should check parent for has()", () => {
      container.register(TOKENS.PostRepository, () => ({}));

      const child = container.createChild();

      expect(child.has(TOKENS.PostRepository)).toBeTruthy();
    });
  });

  describe("clear", () => {
    it("should remove all registrations", () => {
      container.register(TOKENS.PostRepository, () => ({}));
      container.register(TOKENS.EventDispatcher, () => ({}));

      container.clear();

      expect(container.has(TOKENS.PostRepository)).toBeFalsy();
      expect(container.has(TOKENS.EventDispatcher)).toBeFalsy();
    });
  });

  describe("getRegisteredTokens", () => {
    it("should return all registered tokens", () => {
      container.register(TOKENS.PostRepository, () => ({}));
      container.register(TOKENS.EventDispatcher, () => ({}));

      const tokens = container.getRegisteredTokens();

      expect(tokens.includes(TOKENS.PostRepository)).toBeTruthy();
      expect(tokens.includes(TOKENS.EventDispatcher)).toBeTruthy();
      expect(tokens.length).toBe(2);
    });

    it("should include parent tokens", () => {
      container.register(TOKENS.PostRepository, () => ({}));

      const child = container.createChild();
      child.register(TOKENS.EventDispatcher, () => ({}));

      const tokens = child.getRegisteredTokens();

      expect(tokens.includes(TOKENS.PostRepository)).toBeTruthy();
      expect(tokens.includes(TOKENS.EventDispatcher)).toBeTruthy();
    });
  });

  describe("peekInstance", () => {
    it("returns undefined for a singleton that has never been resolved (no construction)", () => {
      let callCount = 0;
      container.register(TOKENS.PostRepository, () => {
        callCount++;
        return { id: callCount };
      });

      const peeked = container.peekInstance(TOKENS.PostRepository);

      expect(peeked).toBe(undefined);
      // Peeking MUST NOT invoke the factory — the connection/service stays
      // unconstructed until something actually resolves it.
      expect(callCount).toBe(0);
    });

    it("returns the cached instance after the singleton has been resolved", () => {
      const service = { id: "resolved" };
      container.register(TOKENS.PostRepository, () => service);

      const resolved = container.resolve(TOKENS.PostRepository);
      const peeked = container.peekInstance(TOKENS.PostRepository);

      expect(peeked).toBe(resolved);
      expect(peeked).toBe(service);
    });

    it("returns the registered instance for registerInstance even before resolve", () => {
      const instance = { name: "eager" };
      container.registerInstance(TOKENS.PostRepository, instance);

      expect(container.peekInstance(TOKENS.PostRepository)).toBe(instance);
    });

    it("returns undefined for a transient registration (never cached)", () => {
      container.register(TOKENS.PostRepository, () => ({ id: 1 }), false);

      container.resolve(TOKENS.PostRepository);

      expect(container.peekInstance(TOKENS.PostRepository)).toBe(undefined);
    });

    it("returns undefined for an unregistered token", () => {
      expect(container.peekInstance(Symbol.for("UnknownPeek"))).toBe(undefined);
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
      expect((first as { id: number }).id).toBe(1);

      container.resetSingletons();

      const second = container.resolve(TOKENS.PostRepository);
      expect((second as { id: number }).id).toBe(2);
    });
  });
});

describe("Global Container", () => {
  beforeEach(() => {
    resetContainer();
  });

  describe("getContainer", () => {
    it("should return same container instance", () => {
      const first = getContainer();
      const second = getContainer();

      expect(first).toBe(second);
    });
  });

  describe("resetContainer", () => {
    it("should create new container after reset", () => {
      const first = getContainer();
      first.register(TOKENS.PostRepository, () => ({}));

      resetContainer();

      const second = getContainer();
      expect(second.has(TOKENS.PostRepository)).toBeFalsy();
    });
  });
});

describe("createTestContainer", () => {
  it("should create container with EventDispatcher by default", () => {
    const container = createTestContainer();

    expect(container.has(TOKENS.EventDispatcher)).toBeTruthy();
  });

  it("should apply symbol overrides", () => {
    const mockRepo = { id: "mock" };
    const overrides: Record<symbol, unknown> = {};
    overrides[TOKENS.PostRepository] = mockRepo;

    const container = createTestContainer(overrides);

    const resolved = container.resolve(TOKENS.PostRepository);
    expect(resolved).toBe(mockRepo);
  });
});
