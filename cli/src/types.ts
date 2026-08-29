export interface PersonalInfo {
  name: string;
  location: string;
  phone: string;
  email: string;
  work_authorization: string[];
  clearances: string[];
  links: Array<{ platform: string; url: string }>;
}

export interface ExperienceEntry {
  company: string;
  company_industry: string;
  role: string;
  location: string;
  location_type: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  core_competencies: string[];
  technologies_used: string[];
  raw_achievements: string[];
  quantifiable_metrics: string[];
}

export interface ProjectEntry {
  name: string;
  context: string;
  links: Array<{ type: string; url: string }>;
  startDate: string;
  endDate: string;
  technologies_used: string[];
  raw_achievements: string[];
  quantifiable_metrics: string[];
}

export interface EducationEntry {
  institution: string;
  degree_type: string;
  major: string;
  minor: string;
  location: string;
  startDate: string;
  endDate: string;
  gpa: string;
  honors: string[];
  relevant_coursework: string[];
  thesis_or_capstone: string;
  extracurriculars: string[];
  description: string;
}

export interface Certification {
  name: string;
  issuer: string;
  date: string;
  expiration_date: string;
  credential_id: string;
  link: string;
  description: string;
}

export interface Award {
  title: string;
  issuer: string;
  date: string;
  description: string;
}

export interface Publication {
  title: string;
  venue?: string;
  date: string;
  url?: string;
  description?: string;
}

export interface VolunteeringEntry {
  organization: string;
  role: string;
  location?: string;
  startDate: string;
  endDate?: string;
  isCurrent?: boolean;
  description?: string;
}

export interface Skills {
  programming_languages: string[];
  frameworks_and_libraries: string[];
  infrastructure_and_tools: string[];
  databases: string[];
  spoken_languages: Array<{ language: string; fluency: string; note?: string }>;
  soft_skills: string[];
}

export interface MasterDB {
  personal_info: PersonalInfo;
  summaries: Array<{ target_role: string; content: string }>;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  skills: Skills;
  certifications: Certification[];
  awards_and_honors: Award[];
  publications_and_speaking: Publication[];
  volunteering_and_leadership: VolunteeringEntry[];
  interests: string[];
}

export interface JobDNA {
  job_title: string;
  seniority: string;
  mandatory_technical_skills: string[];
  mandatory_soft_skills: string[];
  nice_to_have_skills: string[];
  ats_keywords: string[];
  company_culture_and_values: string[];
  primary_responsibilities_summary: string;
  tone_recommendation: string;
}

export type SectionType =
  | 'education'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'certifications'
  | 'awards'
  | 'summary'
  | 'spoken_languages'
  | 'volunteering'
  | 'publications'
  | 'interests';

export interface AISelection {
  reasoning: string;
  match_score?: number;
  match_reasoning?: string;
  section_order: SectionType[];
  summary?: string;
  experience: Array<{
    company: string;
    role: string;
    bullets: string[];
  }>;
  projects: Array<{
    name: string;
    bullets: string[];
  }>;
  skills: {
    languages: string[];
    frameworks_and_libraries: string[];
    infrastructure_and_tools: string[];
    databases: string[];
  };
  certifications: string[];
  awards: string[];
  volunteering?: string[];
  publications?: string[];
}

export interface CompatibilityResult {
  compatible: boolean;
  score: number;
  blockers: string[];
  warnings: string[];
  suggestions: string[];
}
