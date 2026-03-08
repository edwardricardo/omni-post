/**
 * Unit tests for PrismaUnitOfWork
 *
 * Part of P2-4: UnitOfWork for multi-step use cases.
 * Verifica la propagación de transacciones mediante AsyncLocalStorage.
 * Tier 0: Sin base de datos real requerida.
 */

import { describe, it, before, after } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

// ── Supresión de console.log para evitar corrupción del protocolo TAP ─────────

let _originalConsoleLog: typeof console.log;
before(() => {
  _originalConsoleLog = console.log;
  console.log = () => {};
});
after(() => {
  console.log = _originalConsoleLog;
});

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Crea un mock de PrismaClient con soporte de transacciones.
 * La implementación del mock ejecuta el callback de $transaction
 * con el txClient interno, simulando el comportamiento real de Prisma.
 */
function createMockPrismaClient(t: TestContext) {
  const mockTx = {
    post: { create: t.mock.fn(async () => ({})) },
    postContent: { create: t.mock.fn(async () => ({})) },
  };

  const client = {
    $transaction: t.mock.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, _opts?: unknown) =>
      fn(mockTx)
    ),
  };

  return { client, tx: mockTx };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaUnitOfWork", { concurrency: 1 }, () => {
  // ── executeInTransaction ──────────────────────────────────────────────────

  describe("executeInTransaction", { concurrency: 1 }, () => {
    it("ejecuta el callback dentro de una transacción Prisma", async (t) => {
      const { client } = createMockPrismaClient(t);
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
      const uow = new PrismaUnitOfWork(client as never);

      let executed = false;
      await uow.executeInTransaction(async () => {
        executed = true;
      });

      assert.ok(executed, "El callback debe haberse ejecutado");
      assert.equal(client.$transaction.mock.calls.length, 1);
    });

    it("devuelve el valor retornado por el callback", async (t) => {
      const { client } = createMockPrismaClient(t);
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
      const uow = new PrismaUnitOfWork(client as never);

      const result = await uow.executeInTransaction(async () => 42);

      assert.equal(result, 42);
    });

    it("propaga errores lanzados dentro del callback", async (t) => {
      const { client } = createMockPrismaClient(t);
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
      const uow = new PrismaUnitOfWork(client as never);

      await assert.rejects(
        () =>
          uow.executeInTransaction(async () => {
            throw new Error("error de prueba");
          }),
        { message: "error de prueba" }
      );
    });

    it("pasa las opciones de transacción a Prisma", async (t) => {
      const { client } = createMockPrismaClient(t);
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
      const uow = new PrismaUnitOfWork(client as never);

      await uow.executeInTransaction(async () => {}, { timeout: 10_000, maxWait: 2_000 });

      const callArgs = client.$transaction.mock.calls[0]?.arguments;
      assert.ok(callArgs, "Debe haber argumentos en la llamada");
      assert.equal((callArgs[1] as Record<string, unknown> | undefined)?.timeout, 10_000);
      assert.equal((callArgs[1] as Record<string, unknown> | undefined)?.maxWait, 2_000);
    });

    it("combina opciones por defecto con opciones por llamada", async (t) => {
      const { client } = createMockPrismaClient(t);
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
      // Opciones por defecto: timeout=5000, maxWait=1000
      const uow = new PrismaUnitOfWork(client as never, { timeout: 5_000, maxWait: 1_000 });

      // Opciones por llamada: sólo sobreescribe timeout
      await uow.executeInTransaction(async () => {}, { timeout: 15_000 });

      const callArgs = client.$transaction.mock.calls[0]?.arguments;
      assert.ok(callArgs);
      const opts = callArgs[1] as Record<string, unknown> | undefined;
      assert.equal(opts?.timeout, 15_000, "timeout debe ser sobreescrito por la llamada");
      assert.equal(opts?.maxWait, 1_000, "maxWait debe venir de los valores por defecto");
    });

    it("no incluye opciones undefined en el objeto pasado a Prisma", async (t) => {
      const { client } = createMockPrismaClient(t);
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
      const uow = new PrismaUnitOfWork(client as never);

      await uow.executeInTransaction(async () => {});

      const callArgs = client.$transaction.mock.calls[0]?.arguments;
      assert.ok(callArgs);
      const opts = callArgs[1] as Record<string, unknown>;
      // Con exactOptionalPropertyTypes, las claves undefined no deben aparecer
      assert.ok(!("timeout" in opts), "timeout no debe estar presente si no fue especificado");
      assert.ok(!("maxWait" in opts), "maxWait no debe estar presente si no fue especificado");
      assert.ok(
        !("isolationLevel" in opts),
        "isolationLevel no debe estar presente si no fue especificado"
      );
    });
  });

  // ── getTransactionClient ──────────────────────────────────────────────────

  describe("getTransactionClient", { concurrency: 1 }, () => {
    it("devuelve undefined cuando no hay transacción activa", async () => {
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
      const result = PrismaUnitOfWork.getTransactionClient();
      assert.equal(result, undefined);
    });

    it("devuelve el cliente tx cuando se está dentro de una transacción", async (t) => {
      const { client, tx } = createMockPrismaClient(t);
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
      const uow = new PrismaUnitOfWork(client as never);

      let capturedClient: unknown;
      await uow.executeInTransaction(async () => {
        capturedClient = PrismaUnitOfWork.getTransactionClient();
      });

      assert.ok(capturedClient !== undefined, "Debe haber capturado un cliente tx");
      assert.equal(capturedClient, tx);
    });

    it("devuelve undefined después de que la transacción termina", async (t) => {
      const { client } = createMockPrismaClient(t);
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
      const uow = new PrismaUnitOfWork(client as never);

      await uow.executeInTransaction(async () => {});

      const result = PrismaUnitOfWork.getTransactionClient();
      assert.equal(result, undefined);
    });

    it("aísla clientes tx entre contextos async concurrentes", async (t) => {
      // Dos transacciones UoW concurrentes no deben ver el cliente tx del otro
      const mock1 = createMockPrismaClient(t);
      const mock2 = createMockPrismaClient(t);
      const { PrismaUnitOfWork } = await import(
        "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
      );
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
          assert.equal(
            afterYield,
            client1,
            "Debe seguir siendo el mismo cliente tx después de ceder control"
          );
        }),
        uow2.executeInTransaction(async () => {
          client2 = PrismaUnitOfWork.getTransactionClient();
        }),
      ]);

      assert.ok(client1 !== undefined, "UoW1 debe tener un cliente tx");
      assert.ok(client2 !== undefined, "UoW2 debe tener un cliente tx");
      assert.notEqual(client1, client2, "Cada UoW debe tener su propio cliente tx");
    });
  });

  // ── integración con repositorios ──────────────────────────────────────────

  describe(
    "integración con código de repositorio (detección de UoW activo)",
    {
      concurrency: 1,
    },
    () => {
      it("el código interno accede al cliente tx del UoW activo", async (t) => {
        const { client, tx } = createMockPrismaClient(t);
        const { PrismaUnitOfWork } = await import(
          "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
        );
        const uow = new PrismaUnitOfWork(client as never);

        let innerClient: unknown;
        await uow.executeInTransaction(async () => {
          // Simula lo que hace un repositorio: verificar si hay un UoW activo
          innerClient = PrismaUnitOfWork.getTransactionClient();
        });

        assert.equal(innerClient, tx, "El código interno debe ver el cliente tx del UoW");
      });

      it("múltiples operaciones dentro de executeInTransaction comparten el mismo tx", async (t) => {
        const { client, tx } = createMockPrismaClient(t);
        const { PrismaUnitOfWork } = await import(
          "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js"
        );
        const uow = new PrismaUnitOfWork(client as never);

        const capturedClients: unknown[] = [];
        await uow.executeInTransaction(async () => {
          // Simula múltiples llamadas a repositorios
          capturedClients.push(PrismaUnitOfWork.getTransactionClient());
          await Promise.resolve(); // ceder el event loop brevemente
          capturedClients.push(PrismaUnitOfWork.getTransactionClient());
        });

        assert.equal(capturedClients.length, 2);
        assert.equal(capturedClients[0], tx, "Primera operación debe usar el mismo tx");
        assert.equal(capturedClients[1], tx, "Segunda operación debe usar el mismo tx");
        // Ambas capturas son del mismo cliente
        assert.equal(capturedClients[0], capturedClients[1]);
      });
    }
  );
});
