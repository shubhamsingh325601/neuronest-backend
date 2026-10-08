-- At most one active (OPEN or ACKNOWLEDGED) escalation per child. Enforced in the database so two
-- concurrent submissions cannot both succeed; the service maps the violation to 409.
CREATE UNIQUE INDEX "escalations_one_active_per_child" ON "escalations"("childId") WHERE "status" IN ('OPEN', 'ACKNOWLEDGED');
