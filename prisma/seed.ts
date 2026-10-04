import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PlanTemplateStatus, PrismaClient, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Bootstraps the first ADMIN account from environment variables. Idempotent —
 * re-running updates the name and password hash but never creates a duplicate.
 *
 *   ADMIN_EMAIL, ADMIN_PASSWORD  (required)
 *   ADMIN_NAME                   (optional, defaults to "NeuroNest Admin")
 *
 * Also seeds the starter plan templates from `prisma/seed-data/plan-templates.json`
 * (plan 0016), matched by title — an existing template is left untouched so published
 * templates stay immutable.
 *
 * Run with:  npm run db:seed
 */
interface SeedTemplate {
  title: string;
  description?: string;
  status: PlanTemplateStatus;
  sections?: { title: string }[];
  days: { dayNumber: number; sectionPosition?: number; title: string; instructions: string }[];
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'NeuroNest Admin';

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the admin account.');
  }
  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters.');
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19456),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
  });

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      name,
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
    update: {
      passwordHash,
      name,
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  console.log(`Seeded admin account: ${user.email} (${user.id})`);

  await seedPlanTemplates(user.id);
}

async function seedPlanTemplates(adminId: string): Promise<void> {
  const file = join(__dirname, 'seed-data', 'plan-templates.json');
  if (!existsSync(file)) {
    console.log('No prisma/seed-data/plan-templates.json found; skipping plan templates.');
    return;
  }
  const templates = JSON.parse(readFileSync(file, 'utf8')) as SeedTemplate[];

  for (const template of templates) {
    const existing = await prisma.planTemplate.findFirst({
      where: { title: template.title },
      select: { id: true },
    });
    if (existing) {
      console.log(`Plan template already present, skipped: ${template.title}`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const created = await tx.planTemplate.create({
        data: {
          title: template.title,
          description: template.description,
          status: template.status,
          createdById: adminId,
        },
        select: { id: true },
      });
      const sectionIdByPosition = new Map<number, string>();
      for (const [i, section] of (template.sections ?? []).entries()) {
        const row = await tx.planTemplateSection.create({
          data: { planTemplateId: created.id, title: section.title, position: i + 1 },
          select: { id: true },
        });
        sectionIdByPosition.set(i + 1, row.id);
      }
      await tx.planTemplateDay.createMany({
        data: template.days.map((day) => ({
          planTemplateId: created.id,
          sectionId: day.sectionPosition ? sectionIdByPosition.get(day.sectionPosition) : undefined,
          dayNumber: day.dayNumber,
          title: day.title,
          instructions: day.instructions,
        })),
      });
    });
    console.log(`Seeded plan template: ${template.title} (${template.status})`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
