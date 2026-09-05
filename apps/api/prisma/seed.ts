// This script runs standalone (via `prisma db seed`, not the app's normal
// Nest bootstrap), so it must load `.env` itself — nothing else does that
// for it.
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { getAuth } from '../src/modules/auth/auth.config';
import type { MasterDB } from '@resumiq/ai-bridge';

const prisma = new PrismaClient();

const SEED_USER_EMAIL = process.env.SEED_USER_EMAIL ?? 'dev@resumiq.local';
const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'devpass123';

/**
 * A small but non-empty MasterDB-shaped profile — enough that /profile and
 * /apply/manual's matching pipeline aren't looking at an empty shell.
 * Mirrors the camelCase-column <-> snake_case-MasterDB-shape mapping in
 * profile.service.ts's fromMasterDB().
 */
function seedMasterDB(): MasterDB {
  return {
    personal_info: {
      name: 'Dev User',
      location: 'Remote',
      phone: '',
      email: SEED_USER_EMAIL,
      work_authorization: [],
      clearances: [],
      links: [],
    },
    summaries: [],
    experience: [
      {
        company: 'Acme Corp',
        company_industry: 'Software',
        role: 'Software Engineer',
        location: 'Remote',
        location_type: 'remote',
        startDate: '2022-01',
        endDate: '',
        isCurrent: true,
        core_competencies: ['Backend Development'],
        technologies_used: ['TypeScript', 'Node.js'],
        raw_achievements: ['Shipped a core API used by 10k+ users'],
        quantifiable_metrics: ['Reduced API latency by 30%'],
      },
    ],
    education: [
      {
        institution: 'State University',
        degree_type: 'Bachelor',
        major: 'Computer Science',
        minor: '',
        location: 'Remote',
        startDate: '2018-09',
        endDate: '2022-05',
        gpa: '',
        honors: [],
        relevant_coursework: [],
        thesis_or_capstone: '',
        extracurriculars: [],
        description: '',
      },
    ],
    projects: [],
    skills: {
      programming_languages: ['TypeScript', 'JavaScript'],
      frameworks_and_libraries: ['NestJS', 'React'],
      infrastructure_and_tools: [],
      databases: [],
      spoken_languages: [],
      soft_skills: [],
    },
    certifications: [],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
  };
}

function toCareerProfileData(db: MasterDB) {
  const j = <T>(v: T): Prisma.InputJsonValue => v as unknown as Prisma.InputJsonValue;
  return {
    personalInfo: j(db.personal_info),
    summaries: j(db.summaries),
    experience: j(db.experience),
    education: j(db.education),
    projects: j(db.projects),
    skills: j(db.skills),
    certifications: j(db.certifications),
    awardsAndHonors: j(db.awards_and_honors),
    publicationsAndSpeaking: j(db.publications_and_speaking),
    volunteeringAndLeadership: j(db.volunteering_and_leadership),
    interests: j(db.interests),
  };
}

async function seed(): Promise<void> {
  // Must never run destructively against production data. Allowlist (not
  // denylist) the safe environments so an unset/unexpected NODE_ENV fails
  // closed instead of silently seeding whatever DATABASE_URL points to.
  const isSafeEnv = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  // DANGER: ALLOW_PROD_SEED=true bypasses the environment check above and will
  // create/overwrite seed data in whatever database DATABASE_URL points to —
  // only ever set this intentionally, never as a default or in a shared .env.
  if (!isSafeEnv && process.env.ALLOW_PROD_SEED !== 'true') {
    console.error(
      `Refusing to seed: NODE_ENV="${process.env.NODE_ENV}" is not development/test and ALLOW_PROD_SEED is not "true".`
    );
    process.exit(1);
  }

  let user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });

  if (!user) {
    // signUpEmail throws USER_ALREADY_EXISTS on a rerun — the findUnique
    // check above is what makes this script idempotent, not this call.
    const result = await getAuth().api.signUpEmail({
      body: {
        name: 'Dev User',
        email: SEED_USER_EMAIL,
        password: SEED_USER_PASSWORD,
      },
    });
    user = await prisma.user.findUnique({ where: { id: result.user.id } });
    console.log(`Created user "${SEED_USER_EMAIL}".`);
  } else {
    console.log(`User "${SEED_USER_EMAIL}" already exists, skipping creation.`);
  }

  if (!user) {
    throw new Error('User lookup failed after sign-up.');
  }

  await prisma.careerProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...toCareerProfileData(seedMasterDB()) },
    update: toCareerProfileData(seedMasterDB()),
  });
  console.log(`Career profile seeded for "${SEED_USER_EMAIL}".`);
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
