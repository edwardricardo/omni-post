/**
 * @file correlationId.ts
 * @description The id that names one request in every line of it and in the body of its failure,
 *   as the request's id and as its correlation id: a random UUID the server generates, so it is
 *   unique across boots and instances. No header a client sends is read for it, since a header a
 *   client controls would let it choose the id another request's lines carry.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";

/**
 * @description Generates the id of one request, or of the answer to a connection whose request
 *   could not be read.
 * @returns A random UUID, version 4.
 */
export function createCorrelationId(): string {
  return randomUUID();
}
