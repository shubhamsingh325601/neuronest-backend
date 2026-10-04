-- Plan 0016: copy each existing plan's template days into plan-owned rows (snapshot).
-- Re-runnable: ON CONFLICT DO NOTHING on (planId, dayNumber).
INSERT INTO "plan_days" ("id", "planId", "dayNumber", "title", "instructions", "updatedAt")
SELECT gen_random_uuid(), p."id", d."dayNumber", d."title", d."instructions", CURRENT_TIMESTAMP
FROM "plans" p
JOIN "plan_template_days" d ON d."planTemplateId" = p."planTemplateId"
ON CONFLICT ("planId", "dayNumber") DO NOTHING;
