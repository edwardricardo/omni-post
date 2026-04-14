#!/usr/bin/env node
/**
 * @file generateEncryptionKey.ts
 * @description One-time script to generate PLATFORM_ENCRYPTION_KEY.
 *   Run with: npx tsx apps/api/src/security/generateEncryptionKey.ts
 * @layer infrastructure
 */
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");
process.stdout.write("Generated PLATFORM_ENCRYPTION_KEY:\n");
process.stdout.write(key + "\n");
process.stdout.write("\nAdd to your .env file:\n");
process.stdout.write(`PLATFORM_ENCRYPTION_KEY=${key}\n`);
process.stdout.write("\nStore this key securely. If lost, all credentials must be re-entered.\n");
