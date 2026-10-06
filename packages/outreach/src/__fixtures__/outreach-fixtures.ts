import type { MasterDB, OutreachClaim, OutreachConfig, OutreachDraft } from '@resumiq/schemas';

export const masterDb: MasterDB = {
  personal_info: {
    name: 'Yassine Krichen',
    location: 'Tunis, Tunisia',
    phone: '+216 00 000 000',
    email: 'yassine@example.com',
    work_authorization: [],
    clearances: [],
    links: [
      { platform: 'GitHub', url: 'https://github.com/yassine-k' },
      { platform: 'LinkedIn', url: 'https://www.linkedin.com/in/yassine-k' },
    ],
  },
  summaries: [],
  experience: [
    {
      company: 'Orange Tunisie',
      company_industry: 'Telecom',
      role: 'Software Engineering Intern',
      location: 'Tunis',
      location_type: 'On-site',
      startDate: 'Jun 2025',
      endDate: 'Aug 2025',
      isCurrent: false,
      core_competencies: [],
      technologies_used: ['Java', 'Spring Boot'],
      raw_achievements: ['Built an internal dashboard used by the field operations team'],
      quantifiable_metrics: ['Cut report preparation from 2 hours to 15 minutes'],
    },
  ],
  education: [],
  projects: [
    {
      name: 'TickIT',
      context: '',
      links: [{ type: 'GitHub', url: 'https://github.com/yassine-k/tickit' }],
      startDate: 'Jan 2025',
      endDate: 'May 2025',
      technologies_used: ['Spring Boot', 'Angular', 'PostgreSQL'],
      raw_achievements: [
        'Replaced a manual email-and-file workflow for a 40-person operations team',
        'Migrated the historical backlog into structured tickets',
      ],
      quantifiable_metrics: ['40-person team', '12,000 historical cases migrated'],
    },
    {
      name: 'Resume Engine',
      context: '',
      links: [],
      startDate: 'Sep 2026',
      endDate: 'Present',
      technologies_used: ['TypeScript', 'NestJS', 'Next.js', 'Prisma'],
      raw_achievements: ['Built an AI resume tailoring pipeline'],
      quantifiable_metrics: ['3 LLM agents'],
    },
  ],
  skills: {
    programming_languages: ['TypeScript', 'Java', 'Python', 'C'],
    frameworks_and_libraries: ['Spring Boot', 'Angular', 'NestJS', 'Next.js', 'React'],
    infrastructure_and_tools: ['Docker', 'Git'],
    databases: ['PostgreSQL', 'MongoDB'],
    spoken_languages: [],
    soft_skills: [],
  },
  certifications: [],
  awards_and_honors: [],
  publications_and_speaking: [],
  volunteering_and_leadership: [],
  interests: [],
};

export const config: OutreachConfig = {
  hours_per_week: 20,
  start_date: '2026-10-12',
  summer_internship: { available: true, start: '2027-06-01', min_weeks: 8 },
  availability: {
    en: {
      hours_line: 'I can commit about 20 hours a week',
      start_line: 'starting October 12',
      ask_line: 'I can work part-time remotely now, or join you for a summer 2027 internship',
      overlap: {
        europe: 'I am on UTC+1, the same working hours as Paris and Berlin',
        us: 'I am available 12:00-16:00 ET',
        other: 'I can overlap with most of your working day',
      },
    },
    fr: {
      hours_line: 'Je suis disponible environ 20 heures par semaine',
      start_line: 'dès le 12 octobre',
      ask_line: "Je peux travailler à temps partiel à distance dès maintenant, ou vous rejoindre pour un stage d'été 2027",
      overlap: {
        europe: 'Je suis en UTC+1, mêmes horaires que Paris et Berlin',
        us: 'Je suis disponible de 12h00 à 16h00 ET',
        other: 'Je peux couvrir la plupart de votre journée de travail',
      },
    },
  },
  daily_cap: 20,
  gap_min_minutes: 4,
  gap_max_minutes: 11,
  send_window: { start: '08:30', end: '10:30' },
  follow_up_business_days: 5,
  sender_name: 'Yassine Krichen',
  provider: 'gmail',
};

export const claim: OutreachClaim = {
  id: 'c1',
  text: 'Acme Robotics open-sourced its fleet scheduler',
  url: 'https://acme-robotics.example/blog/fleet-scheduler',
  snapshot_id: 'blog-fleet-scheduler.html',
  quote: 'Today we are open-sourcing the Acme fleet scheduler.',
};

export const companyName = 'Acme Robotics';

export const enDraft: OutreachDraft = {
  subject: 'Your open-sourced fleet scheduler',
  body:
    'Hi Claire, I saw that Acme Robotics open-sourced its fleet scheduler last month, and the way it batches ' +
    'tasks per warehouse zone stood out to me. At INSAT I built TickIT, a ticketing platform that replaced a ' +
    'manual workflow for a 40-person operations team, so reliability under real usage is something I care ' +
    'about. I can commit about 20 hours a week, starting October 12, or join you for a summer 2027 ' +
    'internship. I am on UTC+1, the same working hours as Paris and Berlin. ' +
    'Would you be open to a short call this week?',
  follow_up_body:
    'Hi Claire, one more thought on the fleet scheduler: TickIT also had to absorb a large backlog of ' +
    'historical cases, and I wrote the migration that moved all of them without downtime. If a short call is ' +
    'easier next week, I am happy to work around your calendar. Thanks for reading.',
  cta: 'Would you be open to a short call this week?',
  hook_claim_id: 'c1',
  anchor_phrase: 'open-sourced its fleet scheduler',
  mentioned_projects: ['TickIT'],
  generic: false,
};

export const frDraft: OutreachDraft = {
  subject: 'Votre planificateur de flotte open source',
  body:
    "Bonjour Claire, j'ai vu qu'Acme Robotics a ouvert le code de son planificateur de flotte le mois dernier, " +
    "et la façon dont il regroupe les tâches par zone d'entrepôt m'a marqué. À l'INSAT, j'ai conçu TickIT, " +
    'une plateforme de tickets qui a remplacé un processus manuel pour une équipe de 40 personnes, donc la ' +
    'fiabilité en usage réel est une priorité pour moi. Je suis disponible environ 20 heures par semaine, ' +
    "dès le 12 octobre, ou pour un stage d'été 2027. Je suis en UTC+1, mêmes horaires que Paris et Berlin. " +
    'Auriez-vous le temps pour un court appel cette semaine ?',
  follow_up_body:
    "Bonjour Claire, une précision sur le planificateur de flotte : sur TickIT, j'ai aussi écrit la migration " +
    "qui a repris tout l'historique des dossiers sans interruption. Si un court appel est plus simple la " +
    "semaine prochaine, je m'adapte volontiers à votre agenda. Merci de votre lecture.",
  cta: 'Auriez-vous le temps pour un court appel cette semaine ?',
  hook_claim_id: 'c1',
  anchor_phrase: 'a ouvert le code de son planificateur de flotte',
  mentioned_projects: ['TickIT'],
  generic: false,
};
