// Shape the LaTeX renderer takes. Copied from the main resume app (duplicated on purpose so this
// folder can be published on its own).
export type { MasterDB } from './master-db';

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
