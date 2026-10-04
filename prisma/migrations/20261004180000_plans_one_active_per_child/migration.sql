-- At most one ACTIVE plan per child (plan 0009 B-6). Prisma cannot express partial
-- indexes, so this is hand-written; keep the comment on `model Plan` so a later
-- `migrate dev` author does not drop it.

-- Pre-flight: abort loudly if any child already has more than one ACTIVE plan.
-- Resolve by archiving all but the intended plan, then re-run:
--   SELECT "childId", count(*) FROM plans WHERE status = 'ACTIVE' GROUP BY "childId" HAVING count(*) > 1;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM plans WHERE status = 'ACTIVE' GROUP BY "childId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate ACTIVE plans exist - resolve before applying (see plan 0009 section 4)';
  END IF;
END $$;

CREATE UNIQUE INDEX "plans_one_active_per_child" ON "plans" ("childId") WHERE status = 'ACTIVE';
