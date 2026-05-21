-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "Glossary" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "usage" TEXT,
    "embedding" vector(768),
    "embeddingModel" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Glossary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleGuideRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "example" TEXT,
    "category" TEXT,
    "embedding" vector(768),
    "embeddingModel" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StyleGuideRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Glossary_accountId_locale_idx" ON "Glossary"("accountId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "Glossary_accountId_locale_term_key" ON "Glossary"("accountId", "locale", "term");

-- CreateIndex
CREATE INDEX "StyleGuideRule_accountId_locale_idx" ON "StyleGuideRule"("accountId", "locale");

-- AddForeignKey
ALTER TABLE "Glossary" ADD CONSTRAINT "Glossary_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleGuideRule" ADD CONSTRAINT "StyleGuideRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (HNSW cosine — pgvector ≥ 0.7; Prisma DSL does not emit HNSW natively)
CREATE INDEX "Glossary_embedding_hnsw_idx" ON "Glossary" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex (HNSW cosine)
CREATE INDEX "StyleGuideRule_embedding_hnsw_idx" ON "StyleGuideRule" USING hnsw ("embedding" vector_cosine_ops);
