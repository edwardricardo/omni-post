/**
 * Unit tests for PrismaUnitOfWork
 *
 * Part of P2-4: UnitOfWork for multi-step use cases.
 * Verifica la propagación de transacciones mediante AsyncLocalStorage.
 * Tier 0: Sin base de datos real requerida.
 *
 * @file PrismaUnitOfWork.test.ts
 * @description Tests for PrismaUnitOfWork
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, vi, expect } from "vitest";
// ── Supresión de console.log para evitar corrupción del protocolo TAP ─────────

let _originalConsoleLog: typeof console.log;
beforeAll(() => {
  _originalConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
  console.log = _originalConsoleLog;
});

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Crea un mock de PrismaClient con soporte de transacciones.
 * La implementación del mock ejecuta el callback de $transaction
 * con el txClient interno, simulando el comportamiento real de Prisma.
 */
function createMockPrismaClient() {
  const mockTx = {
    post: { create: vi.fn(async () => ({})) },
    postContent: { create: vi.fn(async () => ({})) },
  };

  const client = {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, _opts?: unknown) =>
      fn(mockTx)
    ),
  };

  return { client, tx: mockTx };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaUnitOfWork", () => {
  // ── executeInTransaction ──────────────────────────────────────────────────

  describe("executeInTransaction", () => {
    it("ejecuta el callback dentro de una transacción Prisma", async (_t) => {
      const { client } = createMockPrismaClient();
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      const uow = new PrismaUnitOfWork(client as never);

      let executed = false;
      await uow.executeInTransaction(async () => {
        executed = true;
      });

      expect(executed).toBeTruthy();
      expect(client.$transaction.mock.calls.length).toBe(1);
    });

    it("devuelve el valor retornado por el callback", async (_t) => {
      const { client } = createMockPrismaClient();
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      const uow = new PrismaUnitOfWork(client as never);

      const result = await uow.executeInTransaction(async () => 42);

      expect(result).toBe(42);
    });

    it("propaga errores lanzados dentro del callback", async (_t) => {
      const { client } = createMockPrismaClient();
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      const uow = new PrismaUnitOfWork(client as never);

      await expect(() =>
        uow.executeInTransaction(async () => {
          throw new Error("error de prueba");
        })
      ).rejects.toThrow("error de prueba");
    });

    it("pasa las opciones de transacción a Prisma", async (_t) => {
      const { client } = createMockPrismaClient();
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      const uow = new PrismaUnitOfWork(client as never);

      await uow.executeInTransaction(async () => {}, { timeout: 10_000, maxWait: 2_000 });

      const callArgs = client.$transaction.mock.calls[0];
      expect(callArgs).toBeTruthy();
      expect((callArgs[1] as Record<string, unknown> | undefined)?.timeout).toBe(10_000);
      expect((callArgs[1] as Record<string, unknown> | undefined)?.maxWait).toBe(2_000);
    });

    it("combina opciones por defecto con opciones por llamada", async (_t) => {
      const { client } = createMockPrismaClient();
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      // Opciones por defecto: timeout=5000, maxWait=1000
      const uow = new PrismaUnitOfWork(client as never, { timeout: 5_000, maxWait: 1_000 });

      // Opciones por llamada: sólo sobreescribe timeout
      await uow.executeInTransaction(async () => {}, { timeout: 15_000 });

      const callArgs = client.$transaction.mock.calls[0];
      expect(callArgs).toBeTruthy();
      const opts = callArgs[1] as Record<string, unknown> | undefined;
      expect(opts?.timeout).toBe(15_000);
      expect(opts?.maxWait).toBe(1_000);
    });

    it("no incluye opciones undefined en el objeto pasado a Prisma", async (_t) => {
      const { client } = createMockPrismaClient();
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      const uow = new PrismaUnitOfWork(client as never);

      await uow.executeInTransaction(async () => {});

      const callArgs = client.$transaction.mock.calls[0];
      expect(callArgs).toBeTruthy();
      const opts = callArgs[1] as Record<string, unknown>;
      // Con exactOptionalPropertyTypes, las claves undefined no deben aparecer
      expect("timeout" in opts).toBeFalsy();
      expect("maxWait" in opts).toBeFalsy();
      expect("isolationLevel" in opts).toBeFalsy();
    });
  });

  // ── getTransactionClient ──────────────────────────────────────────────────

  describe("getTransactionClient", () => {
    it("devuelve undefined cuando no hay transacción activa", async () => {
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      const result = PrismaUnitOfWork.getTransactionClient();
      expect(result).toBe(undefined);
    });

    it("devuelve el cliente tx cuando se está dentro de una transacción", async (_t) => {
      const { client, tx } = createMockPrismaClient();
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      const uow = new PrismaUnitOfWork(client as never);

      let capturedClient: unknown;
      await uow.executeInTransaction(async () => {
        capturedClient = PrismaUnitOfWork.getTransactionClient();
      });

      expect(capturedClient !== undefined).toBeTruthy();
      expect(capturedClient).toBe(tx);
    });

    it("devuelve undefined después de que la transacción termina", async (_t) => {
      const { client } = createMockPrismaClient();
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      const uow = new PrismaUnitOfWork(client as never);

      await uow.executeInTransaction(async () => {});

      const result = PrismaUnitOfWork.getTransactionClient();
      expect(result).toBe(undefined);
    });

    it("aísla clientes tx entre contextos async concurrentes", async (_t) => {
      // Dos transacciones UoW concurrentes no deben ver el cliente tx del otro
      const mock1 = createMockPrismaClient();
      const mock2 = createMockPrismaClient();
      const { PrismaUnitOfWork } =
        await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
      const uow1 = new PrismaUnitOfWork(mock1.client as never);
      const uow2 = new PrismaUnitOfWork(mock2.client as never);

      let client1: unknown;
      let client2: unknown;

      await Promise.all([
        uow1.executeInTransaction(async () => {
          client1 = PrismaUnitOfWork.getTransactionClient();
          // Ceder control para que la otra transacción pueda ejecutarse
          await new Promise<void>((r) => setTimeout(r, 10));
          // Debe seguir siendo el mismo cliente después de ceder control
          const afterYield = PrismaUnitOfWork.getTransactionClient();
          expect(afterYield).toBe(client1);
        }),
        uow2.executeInTransaction(async () => {
          client2 = PrismaUnitOfWork.getTransactionClient();
        }),
      ]);

      expect(client1 !== undefined).toBeTruthy();
      expect(client2 !== undefined).toBeTruthy();
      expect(client1).not.toBe(client2);
    });
  });

  // ── integración con repositorios ──────────────────────────────────────────

  describe(
    "integración con código de repositorio (detección de UoW activo)",
    {
      concurrency: 1,
    },
    () => {
      it("el código interno accede al cliente tx del UoW activo", async (_t) => {
        const { client, tx } = createMockPrismaClient();
        const { PrismaUnitOfWork } =
          await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
        const uow = new PrismaUnitOfWork(client as never);

        let innerClient: unknown;
        await uow.executeInTransaction(async () => {
          // Simula lo que hace un repositorio: verificar si hay un UoW activo
          innerClient = PrismaUnitOfWork.getTransactionClient();
        });

        expect(innerClient).toBe(tx);
      });

      it("múltiples operaciones dentro de executeInTransaction comparten el mismo tx", async (_t) => {
        const { client, tx } = createMockPrismaClient();
        const { PrismaUnitOfWork } =
          await import("../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js");
        const uow = new PrismaUnitOfWork(client as never);

        const capturedClients: unknown[] = [];
        await uow.executeInTransaction(async () => {
          // Simula múltiples llamadas a repositorios
          capturedClients.push(PrismaUnitOfWork.getTransactionClient());
          await Promise.resolve(); // ceder el event loop brevemente
          capturedClients.push(PrismaUnitOfWork.getTransactionClient());
        });

        expect(capturedClients.length).toBe(2);
        expect(capturedClients[0]).toBe(tx);
        expect(capturedClients[1]).toBe(tx);
        // Ambas capturas son del mismo cliente
        expect(capturedClients[0]).toBe(capturedClients[1]);
      });
    }
  );
});
