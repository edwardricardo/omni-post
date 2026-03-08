// Must be imported before any module that uses @infra/prisma
// ESM processes imports before module code, so this file must be
// imported as a side-effect to ensure DATABASE_URL is set early.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mockdb";
}
