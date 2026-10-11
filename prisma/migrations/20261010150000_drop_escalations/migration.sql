-- Escalations are not part of the product (plan 0019 batch 1). Dropping the table also drops its
-- indexes (including the partial unique index) and foreign keys.
-- DropTable
DROP TABLE "escalations";

-- DropEnum
DROP TYPE "EscalationStatus";
