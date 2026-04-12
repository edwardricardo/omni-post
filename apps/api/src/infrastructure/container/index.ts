/**
 * @file index.ts
 * @description Barrel export for the DI container module.
 * @layer infrastructure
 */

export { TOKENS, type Token, type ServiceFactory, type ContainerOptions } from "./types.js";
export { Container, getContainer, resetContainer } from "./Container.js";
export { createTestContainer, type ContainerSetupOptions } from "./setup.js";
