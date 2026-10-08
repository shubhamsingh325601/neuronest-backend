import 'dotenv/config';
import { PlanStatus, PlanTemplateStatus, PrismaClient, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * DEVELOPMENT ONLY — fills a local database with a realistic demo so the Parent app has something to show.
 * Refuses to run in production. Idempotent: re-running replaces the demo plan content, never duplicates users.
 *
 *   DEMO_PARENT_EMAIL   existing verified parent to attach the demo to (default priya.sharma@email.com)
 *   DEMO_PASSWORD       password for the demo clinician/admin accounts (default Password123!)
 *
 * Creates: a demo admin and clinician (Dr. E. Okafor), the parent's child (if missing), the clinician
 * assignment, a clinical profile, a 4-week plan (week 3 is current), one coaching tip and a few call slots.
 *
 * Run with:  npm run db:seed:demo
 */
const prisma = new PrismaClient();

const DAY_MS = 86_400_000;

interface ActivitySeed {
  title: string;
  shortDescription: string;
  goalCategory: string;
  domain: string;
  durationMinutes: number;
  whyItMatters: string;
  steps: { title: string; instruction: string; tip?: string }[];
  scriptQuote: string;
  equipment: string[];
}

const ACTIVITIES: ActivitySeed[] = [
  {
    title: 'Narrate the morning routine',
    shortDescription: 'Say each step in three words ("Brush teeth now", "Put socks on").',
    goalCategory: 'Language Goal',
    domain: 'Expressive Communication',
    durationMinutes: 5,
    whyItMatters: 'Modelling short phrases builds spontaneous speech in low-pressure moments.',
    steps: [
      { title: 'Get ready', instruction: 'Start the routine at the usual time and stay close.' },
      { title: 'Narrate', instruction: 'Say each action in three words as it happens.', tip: 'Keep your voice calm.' },
      { title: 'Pause', instruction: 'Wait five seconds to give a chance to copy you.' },
    ],
    scriptQuote: 'Socks on now.',
    equipment: [],
  },
  {
    title: 'Use a visual timer before nursery',
    shortDescription: 'Show the timer easing the transition to the door.',
    goalCategory: 'Transitions Goal',
    domain: 'Transitions',
    durationMinutes: 2,
    whyItMatters: 'Seeing time pass makes endings predictable and less upsetting.',
    steps: [
      { title: 'Set the timer', instruction: 'Show the timer and say "Shoes in two minutes".' },
      { title: 'Count down', instruction: 'Point to the timer once or twice as it runs.' },
      { title: 'Celebrate', instruction: 'Praise the move to the door when it ends.' },
    ],
    scriptQuote: 'Timer ends, shoes on.',
    equipment: ['Visual timer'],
  },
  {
    title: 'One turn-taking game',
    shortDescription: 'Roll a ball back and forth, saying "my turn, your turn".',
    goalCategory: 'Turn-taking Goal',
    domain: 'Social Interaction',
    durationMinutes: 10,
    whyItMatters: 'Simple back-and-forth games practise waiting and sharing attention.',
    steps: [
      { title: 'Sit facing each other', instruction: 'Sit on the floor a metre apart.' },
      { title: 'Roll and say', instruction: 'Roll the ball and say "my turn", then "your turn".' },
      { title: 'Follow their lead', instruction: 'Let them choose when to stop.' },
    ],
    scriptQuote: 'My turn... your turn.',
    equipment: ['Soft ball'],
  },
  {
    title: 'Name the snack',
    shortDescription: 'Offer two snacks and wait for a word or point.',
    goalCategory: 'Language Goal',
    domain: 'Expressive Communication',
    durationMinutes: 5,
    whyItMatters: 'Choices give a real reason to communicate.',
    steps: [
      { title: 'Offer two', instruction: 'Hold up two snacks and name them.' },
      { title: 'Wait', instruction: 'Pause for a word, sound or point.' },
      { title: 'Reward', instruction: 'Give the snack straight away and repeat the word.' },
    ],
    scriptQuote: 'Apple or banana?',
    equipment: ['Two snacks'],
  },
  {
    title: 'Calm corner practice',
    shortDescription: 'Visit the quiet corner when calm so it feels safe later.',
    goalCategory: 'Emotional Regulation',
    domain: 'Emotional Regulation',
    durationMinutes: 5,
    whyItMatters: 'A familiar calm space is easier to use when upset.',
    steps: [
      { title: 'Set up', instruction: 'Add a cushion, blanket and one favourite toy.' },
      { title: 'Visit together', instruction: 'Sit there for two minutes with soft music.' },
    ],
    scriptQuote: 'This is our calm place.',
    equipment: ['Cushion', 'Light blanket'],
  },
  {
    title: 'Heavy-work reset',
    shortDescription: 'Carry a basket of books or push a laundry basket.',
    goalCategory: 'Sensory Processing',
    domain: 'Sensory Processing',
    durationMinutes: 5,
    whyItMatters: 'Pushing and carrying calms the body.',
    steps: [
      { title: 'Choose a job', instruction: 'Ask for help carrying a light basket.' },
      { title: 'Move', instruction: 'Walk it across the room and back twice.' },
    ],
    scriptQuote: 'Strong helper!',
    equipment: ['Laundry basket'],
  },
];

const WEEKS = [
  { title: 'Settling into routines', focus: 'Predictable mornings and simple words', domain: 'Language' },
  { title: 'Words at snack time', focus: 'Choice-making and single words', domain: 'Language' },
  { title: 'Expressive 3-Word Requests', focus: 'Asking for things using three words', domain: 'Language' },
  { title: 'Using words to wait and share', focus: 'Turn-taking and calm transitions', domain: 'Social' },
];

async function upsertUser(email: string, name: string, role: Role, passwordHash: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, role, passwordHash, status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
    update: { name, role, passwordHash, status: UserStatus.ACTIVE },
  });
  return user.id;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-demo refuses to run when NODE_ENV=production.');
  }
  const parentEmail = (process.env.DEMO_PARENT_EMAIL ?? 'priya.sharma@email.com').toLowerCase().trim();
  const passwordHash = await argon2.hash(process.env.DEMO_PASSWORD ?? 'Password123!', { type: argon2.argon2id });

  const parent = await prisma.user.findUnique({ where: { email: parentEmail } });
  if (!parent) {
    throw new Error(`No parent with email ${parentEmail}. Sign up in the app first, or set DEMO_PARENT_EMAIL.`);
  }

  const adminId = await upsertUser('demo.admin@neuronest.local', 'Demo Admin', Role.ADMIN, passwordHash);
  const clinicianId = await upsertUser('e.okafor@neuronest.local', 'Dr. E. Okafor', Role.CLINICIAN, passwordHash);
  await prisma.clinicianProfile.upsert({
    where: { userId: clinicianId },
    create: {
      userId: clinicianId,
      specialisation: 'Lead Paediatric Clinical Psychologist',
      qualifications: 'DClinPsy, HCPC Reg, CPsychol',
      bio: 'Early childhood neurodevelopment and parent-led language strategies.',
    },
    update: {},
  });

  const dob = new Date(Date.now() - 5 * 365 * DAY_MS);
  const child = await prisma.child.upsert({
    where: { parentId: parent.id },
    create: { parentId: parent.id, name: 'Aarav', dateOfBirth: dob },
    update: {},
  });
  await prisma.child.update({
    where: { id: child.id },
    data: {
      preferredName: child.preferredName ?? 'Aarav',
      gender: child.gender ?? 'Male',
      primaryLanguage: child.primaryLanguage ?? 'English',
      clinicalProfile: {
        currentStage: 'Emerging communicator',
        observationSummary: 'Enjoys pattern play and responds well to visual supports.',
        primaryCareFocus: 'Three-word requests',
        strengths: [
          { title: 'Pattern play', description: 'Loves puzzles, blocks and sorting.', icon: 'puzzle', category: 'Cognitive' },
          { title: 'Visual learner', description: 'Picks up routines quickly from pictures.', icon: 'eye', category: 'Learning' },
        ],
        sensoryTraits: [
          {
            domain: 'Auditory',
            sensitivityLevel: 'HIGH',
            triggers: ['Hand dryers', 'Blenders'],
            accommodations: ['Headphones', 'Warn before loud sounds'],
          },
        ],
        calmingPreferences: [
          { title: 'Deep pressure', technique: 'A weighted blanket or firm hugs.', effectiveness: 'Works well' },
        ],
        communication: {
          expressiveMode: 'Single words and short phrases',
          receptiveUnderstanding: 'Follows two-step instructions',
          preferredPrompts: ['Show me', 'What do you want?'],
        },
      },
    },
  });

  await prisma.clinicianChildAssignment.upsert({
    where: { clinicianId_childId: { clinicianId, childId: child.id } },
    create: { clinicianId, childId: child.id, assignedByAdminId: adminId },
    update: {},
  });

  // Plan: started 16 days ago => week 3, day 3.
  const template =
    (await prisma.planTemplate.findFirst({ where: { title: 'Demo 4-week plan' } })) ??
    (await prisma.planTemplate.create({
      data: { title: 'Demo 4-week plan', status: PlanTemplateStatus.PUBLISHED, createdById: adminId },
    }));
  let plan = await prisma.plan.findFirst({ where: { childId: child.id, status: PlanStatus.ACTIVE } });
  if (!plan) {
    const start = new Date(Date.now() - 16 * DAY_MS);
    start.setUTCHours(0, 0, 0, 0);
    plan = await prisma.plan.create({
      data: { childId: child.id, planTemplateId: template.id, startDate: start, createdById: clinicianId },
    });
  }

  for (const [index, week] of WEEKS.entries()) {
    const weekNumber = index + 1;
    const row = await prisma.planWeek.upsert({
      where: { planId_weekNumber: { planId: plan.id, weekNumber } },
      create: {
        planId: plan.id,
        weekNumber,
        title: week.title,
        focus: week.focus,
        guidance: {
          title: 'This week at home',
          scriptSnippet: 'Say what you are doing in three words.',
          practicalTip: 'Pause for five seconds and let them try.',
          context: 'Everyday routines',
        },
      },
      update: { title: week.title, focus: week.focus },
    });
    await prisma.planGoal.deleteMany({ where: { weekId: row.id } });
    await prisma.planGoal.createMany({
      data: [
        { title: week.focus, description: `Practise ${week.focus.toLowerCase()} in daily routines.`, domain: week.domain, icon: 'target' },
        { title: 'Shared attention', description: 'Look together at the same thing.', domain: 'Social', icon: 'eye' },
        { title: 'Calm transitions', description: 'Move between activities with a warning.', domain: 'Regulation', icon: 'wind' },
      ].map((g, i) => ({ ...g, weekId: row.id, position: i + 1 })),
    });
    for (const [i, a] of ACTIVITIES.entries()) {
      const data = {
        dayOfWeek: (i % 7) + 1,
        title: a.title,
        shortDescription: a.shortDescription,
        goalCategory: a.goalCategory,
        domain: a.domain,
        durationMinutes: a.durationMinutes,
        whyItMatters: a.whyItMatters,
        steps: a.steps,
        parentScript: { title: 'Try saying', scriptQuote: a.scriptQuote, tip: 'Keep it calm and short.', context: 'Daily routine' },
        equipment: a.equipment,
      };
      await prisma.planActivity.upsert({
        where: { weekId_position: { weekId: row.id, position: i + 1 } },
        create: { weekId: row.id, position: i + 1, ...data },
        update: data,
      });
    }
  }

  await prisma.coachingTip.deleteMany({ where: { planId: plan.id } });
  await prisma.coachingTip.createMany({
    data: [
      {
        childId: child.id,
        planId: plan.id,
        weekNumber: 3,
        position: 1,
        title: 'The Three-Word Model During Everyday Moments',
        body: 'Help Aarav expand single-word requests into natural three-word combinations during play and snack times.',
        whyItMatters:
          'Modelling just one word beyond his current phrase builds sentence structure without any pressure to repeat.',
        steps: [
          'Notice when he points or says a single word',
          'Hold the item near your chest so he looks at you',
          'Say the three-word phrase warmly, then hand it over',
        ],
        scriptQuote: 'Blue car zoom! / More apple please!',
        scriptContext: 'During snack time and block play',
        authorId: clinicianId,
      },
      {
        childId: child.id,
        planId: plan.id,
        weekNumber: 3,
        position: 2,
        title: 'Wait before you help',
        body: 'Count to five before stepping in so there is time to try a word.',
        authorId: clinicianId,
      },
    ],
  });

  // A few bookable call slots over the next fortnight (existing ones get the video link too).
  const DEMO_MEETING_URL = 'https://meet.example.com/neuronest-demo';
  for (const offsetDays of [3, 5, 8, 10]) {
    const startsAt = new Date(Date.now() + offsetDays * DAY_MS);
    startsAt.setUTCHours(10, 30, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    await prisma.appointmentSlot.upsert({
      where: { clinicianId_startsAt: { clinicianId, startsAt } },
      create: {
        clinicianId,
        startsAt,
        endsAt,
        createdById: clinicianId,
        meetingUrl: DEMO_MEETING_URL,
      },
      update: { meetingUrl: DEMO_MEETING_URL },
    });
  }

  // One call from two weeks ago, with the summary the clinician wrote afterwards.
  const pastStart = new Date(Date.now() - 14 * DAY_MS);
  pastStart.setUTCHours(10, 30, 0, 0);
  const pastSlot = await prisma.appointmentSlot.upsert({
    where: { clinicianId_startsAt: { clinicianId, startsAt: pastStart } },
    create: {
      clinicianId,
      startsAt: pastStart,
      endsAt: new Date(pastStart.getTime() + 30 * 60_000),
      createdById: clinicianId,
    },
    update: {},
  });
  await prisma.appointment.upsert({
    where: { slotId: pastSlot.id },
    create: {
      slotId: pastSlot.id,
      childId: child.id,
      bookedById: child.parentId,
      summary:
        'Plan kickoff. We focused on baseline engagement, spotting sound triggers and introducing predictable morning routines.',
      actionPoints: [
        'Use a visual timer before nursery departures',
        'Model single-word requests at chest height',
        'Keep a 5-minute quiet wind-down each evening',
      ],
    },
    update: {},
  });

  console.log(`Demo ready for ${parentEmail}: child ${child.name}, plan ${plan.id} (week 3 current).`);
  console.log('Demo clinician: e.okafor@neuronest.local / demo admin: demo.admin@neuronest.local (DEMO_PASSWORD).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
