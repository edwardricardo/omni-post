/**
 * @file Container.ts
 * @description Lightweight dependency injection container with symbol-based tokens,
 *              singleton/transient lifetimes, and child container support.
 * @layer infrastructure
 */

import type { Token, ServiceFactory, ServiceRegistration, ContainerOptions } from "./types.js";

/**
 * Lightweight Dependency Injection Container
 *
 * Features:
 * - Symbol-based service tokens for type safety
 * - Singleton and transient service lifetimes
 * - Factory-based service creation
 * - Child container support for scoped dependencies
 *
 * @example
 * const container = new Container();
 * container.register(TOKENS.PostRepository, () =>
 *   new PrismaPostRepository(prisma, outboxWriter, ambientTenantContextProvider));
 * const repo = container.resolve<PostRepository>(TOKENS.PostRepository);
 */
export class Container {
  private readonly services = new Map<symbol, ServiceRegistration<unknown>>();
  private readonly parent: Container | undefined;
  private readonly options: Required<ContainerOptions>;

  constructor(options: ContainerOptions = {}, parent?: Container) {
    this.options = {
      defaultSingleton: options.defaultSingleton ?? true,
    };
    this.parent = parent ?? undefined;
  }

  /**
   * @method register
   * @description Register a service factory under a token.
   * @param token - Service identifier token
   * @param factory - Factory function to create the service
   * @param singleton - Whether to create a singleton instance (default: true)
   * @returns The container, for chaining
   */
  register<T>(token: Token, factory: ServiceFactory<T>, singleton?: boolean): this {
    this.services.set(token, {
      factory,
      singleton: singleton ?? this.options.defaultSingleton,
    });
    return this;
  }

  /**
   * @method registerInstance
   * @description Register a singleton service with an existing instance. `undefined`
   *   is refused because `resolve` and `peekInstance` read an `undefined` instance
   *   as "not built yet", so a registered `undefined` would resolve silently instead
   *   of failing with `Service not registered`.
   * @param token - Service identifier token
   * @param instance - Existing service instance; never `undefined`
   * @returns The container, for chaining
   * @throws Error if `instance` is `undefined`; the call registers nothing, and a
   *   registration the token already holds stays as it was
   */
  registerInstance<T>(token: Token, instance: T & ({} | null)): this {
    if (instance === undefined) {
      throw new Error(`Cannot register undefined as an instance: ${token.toString()}`);
    }
    this.services.set(token, {
      factory: () => instance,
      singleton: true,
      instance,
    });
    return this;
  }

  /**
   * @method resolve
   * @description Resolve a service by its token, consulting the parent container when
   *   the token is not registered here.
   * @param token - Service identifier token
   * @returns The service instance
   * @throws Error if service is not registered
   */
  resolve<T>(token: Token): T {
    const registration = this.services.get(token);

    if (!registration) {
      // Check parent container
      if (this.parent) {
        return this.parent.resolve<T>(token);
      }
      throw new Error(`Service not registered: ${token.toString()}`);
    }

    // Return existing singleton instance
    if (registration.singleton && registration.instance !== undefined) {
      return registration.instance as T;
    }

    // Create new instance
    const instance = registration.factory() as T;

    // Cache singleton instance
    if (registration.singleton) {
      registration.instance = instance;
    }

    return instance;
  }

  /**
   * @method tryResolve
   * @description Try to resolve a service, returning undefined if not found.
   * @param token - Service identifier token
   * @returns The service instance or undefined
   */
  tryResolve<T>(token: Token): T | undefined {
    try {
      return this.resolve<T>(token);
    } catch {
      return undefined;
    }
  }

  /**
   * @method peekInstance
   * @description Return a singleton's cached instance WITHOUT constructing it.
   *
   * Unlike `resolve`, this never invokes the factory: it returns the instance
   * only if the singleton has already been resolved (or was registered eagerly
   * via `registerInstance`), and `undefined` otherwise. Used by the shutdown
   * sequence to quit composition-root-owned connections (e.g. the saga
   * subscriber, analytics Redis) ONLY when they were actually constructed
   * during the process lifetime — quitting an unresolved lazy singleton would
   * otherwise force-create a brand-new socket at teardown just to close it.
   *
   * Transient registrations always return `undefined` (they are never cached).
   *
   * @param token - Service identifier token
   * @returns The cached singleton instance, or `undefined` if not yet built
   */
  peekInstance<T>(token: Token): T | undefined {
    const registration = this.services.get(token);
    if (registration) {
      if (registration.singleton && registration.instance !== undefined) {
        return registration.instance as T;
      }
      return undefined;
    }
    return this.parent?.peekInstance<T>(token);
  }

  /**
   * @method has
   * @description Check if a service is registered here or in a parent container.
   * @param token - Service identifier token
   * @returns True when the token is registered
   */
  has(token: Token): boolean {
    if (this.services.has(token)) {
      return true;
    }
    return this.parent?.has(token) ?? false;
  }

  /**
   * @method createChild
   * @description Create a child container with its own registrations. Child
   *   containers can override parent registrations.
   * @returns A new child container
   */
  createChild(): Container {
    return new Container(this.options, this);
  }

  /**
   * @method clear
   * @description Clear all registered services of this container.
   */
  clear(): void {
    this.services.clear();
  }

  /**
   * @method getRegisteredTokens
   * @description Get all registered tokens, parent tokens included.
   * @returns Every registered token, without duplicates
   */
  getRegisteredTokens(): symbol[] {
    const tokens = [...this.services.keys()];
    if (this.parent) {
      const parentTokens = this.parent.getRegisteredTokens();
      for (const token of parentTokens) {
        if (!tokens.includes(token)) {
          tokens.push(token);
        }
      }
    }
    return tokens;
  }

  /**
   * @method resetSingletons
   * @description Reset singleton instances (useful for testing).
   */
  resetSingletons(): void {
    for (const registration of this.services.values()) {
      if (registration.singleton) {
        registration.instance = undefined;
      }
    }
  }
}

/**
 * Global container instance
 */
let globalContainer: Container | undefined;

/**
 * @description Get or create the global container instance.
 * @returns The global container
 */
export function getContainer(): Container {
  if (!globalContainer) {
    globalContainer = new Container();
  }
  return globalContainer;
}

/**
 * @description Set the global container instance (useful for testing).
 * @param container - Container to install as the global instance
 */
export function setContainer(container: Container): void {
  globalContainer = container;
}

/**
 * @description Reset the global container (useful for testing).
 */
export function resetContainer(): void {
  globalContainer?.clear();
  globalContainer = undefined;
}
