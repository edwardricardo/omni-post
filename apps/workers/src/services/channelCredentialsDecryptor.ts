/**
 * @file channelCredentialsDecryptor.ts
 * @description The workers' half of the `Channel.credentials` contract: the key ring
 *              built from the workers' typed env, and the decryptor the db-prisma
 *              channel repository calls once per row. Publishing and mention ingest
 *              both use these two functions, so the workers read with one key ring and
 *              one AAD rule, the ones the API writes with. Reads no env itself: the
 *              caller passes the env in, so importing this module never triggers the
 *              env module's boot-time validation.
 * @layer infrastructure
 */
import type { ChannelCredentialsDecryptor } from "@adapters/db-prisma";
import {
  createEncryptionKeyRing,
  decryptChannelCredentials,
  type EncryptionKeyRing,
} from "@shared/types/channelCredentialsCrypto.js";

/** The fields of the workers' typed env that carry the platform encryption keys. */
interface WorkerEncryptionKeyEnv {
  readonly PLATFORM_ENCRYPTION_KEY: string;
  readonly PLATFORM_ENCRYPTION_KEY_VERSION: number;
  readonly PLATFORM_ENCRYPTION_KEY_V1?: string | undefined;
  readonly PLATFORM_ENCRYPTION_KEY_V2?: string | undefined;
  readonly PLATFORM_ENCRYPTION_KEY_V3?: string | undefined;
}

/**
 * @function buildWorkerEncryptionKeyRing
 * @description Builds the key ring from the workers' env: the active key and version,
 *              and the prior keys `PLATFORM_ENCRYPTION_KEY_V1..V3` of a rotation window,
 *              the same variables the API's `EncryptionService` reads. Every key is
 *              decoded and length-checked here, so a malformed key stops the worker when
 *              it starts instead of failing each job.
 * @param keyEnv - The workers' validated env, or any object carrying its key fields.
 * @returns The ring each envelope's key version is resolved against.
 */
export function buildWorkerEncryptionKeyRing(keyEnv: WorkerEncryptionKeyEnv): EncryptionKeyRing {
  const priorKeys = new Map<number, string>();
  if (keyEnv.PLATFORM_ENCRYPTION_KEY_V1) priorKeys.set(1, keyEnv.PLATFORM_ENCRYPTION_KEY_V1);
  if (keyEnv.PLATFORM_ENCRYPTION_KEY_V2) priorKeys.set(2, keyEnv.PLATFORM_ENCRYPTION_KEY_V2);
  if (keyEnv.PLATFORM_ENCRYPTION_KEY_V3) priorKeys.set(3, keyEnv.PLATFORM_ENCRYPTION_KEY_V3);
  return createEncryptionKeyRing({
    activeKeyBase64: keyEnv.PLATFORM_ENCRYPTION_KEY,
    activeVersion: keyEnv.PLATFORM_ENCRYPTION_KEY_VERSION,
    priorKeys,
  });
}

/**
 * @function createChannelCredentialsDecryptor
 * @description The decrypt callback for `createPrismaRepoAdapter`: decrypts a row's
 *              envelope with that row's channel id bound as AAD and the key of the
 *              envelope's version.
 * @param ring - The ring from `buildWorkerEncryptionKeyRing`.
 * @returns The decryptor; it throws on an unknown key version, another row's id or a
 *          tampered envelope, and the repository logs and fails that lookup.
 */
export function createChannelCredentialsDecryptor(
  ring: EncryptionKeyRing
): ChannelCredentialsDecryptor {
  return ({ channelId, envelope }) => decryptChannelCredentials(envelope, { channelId }, ring);
}
