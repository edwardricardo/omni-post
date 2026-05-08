-- Money-as-Decimal canon (T4-U). Float pierde precisión en operaciones financieras
-- (rounding bias al acumular cents, conversión IEEE 754 ↔ decimal). Decimal(19,4)
-- alinea con Invoice.amountDue + Invoice.amountPaid (mismo pattern T4-U).
--
-- Tabla con 0 rows pre-migration verificado → cero data loss.

ALTER TABLE "TemplateAnalytics"
  ALTER COLUMN "revenueGenerated" TYPE numeric(19, 4)
  USING "revenueGenerated"::numeric(19, 4);
