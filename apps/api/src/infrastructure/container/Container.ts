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
 * container.register(TOKENS.PostRepository, () => new PrismaPostRepository(prisma));
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
   * Register a service factory
   *
   * @param token - Service identifier token
   * @param factory - Factory function to create the service
   * @param singleton - Whether to create a singleton instance (default: true)
   */
  register<T>(token: Token, factory: ServiceFactory<T>, singleton?: boolean): this {
    this.services.set(token, {
      factory,
      singleton: singleton ?? this.options.defaultSingleton,
    });
    return this;
  }

  /**
   * Register a singleton service with an existing instance
   *
   * @param token - Service identifier token
   * @param instance - Existing service instance
   */
  registerInstance<T>(token: Token, instance: T): this {
    this.services.set(token, {
      factory: () => instance,
      singleton: true,
      instance,
    });
    return this;
  }

  /**
   * Resolve a service by its token
   *
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
   * Try to resolve a service, returning undefined if not found
   *
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
   * Check if a service is registered
   *
   * @param token - Service identifier token
   */
  has(token: Token): boolean {
    if (this.services.has(token)) {
      return true;
    }
    return this.parent?.has(token) ?? false;
  }

  /**
   * Create a child container with its own registrations
   * Child containers can override parent registrations
   *
   * @returns A new child container
   */
  createChild(): Container {
    return new Container(this.options, this);
  }

  /**
   * Clear all registered services
   */
  clear(): void {
    this.services.clear();
  }

  /**
   * Get all registered tokens
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
   * Reset singleton instances (useful for testing)
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
 * Get or create the global container instance
 */
export function getContainer(): Container {
  if (!globalContainer) {
    globalContainer = new Container();
  }
  return globalContainer;
}

/**
 * Set the global container instance (useful for testing)
 */
export function setContainer(container: Container): void {
  globalContainer = container;
}

/**
 * Reset the global container (useful for testing)
 */
export function resetContainer(): void {
  globalContainer?.clear();
  globalContainer = undefined;
}
