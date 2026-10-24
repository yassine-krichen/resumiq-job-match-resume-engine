import { techKey } from './normalize';

// Common technologies that the inventory may not contain. These are what a
// model injects when it pads a resume from the job description.
export const COMMON_TECH = [
  'Kubernetes', 'Terraform', 'Ansible', 'Kafka', 'RabbitMQ', 'AWS', 'GCP', 'Azure', 'Spark',
  'Hadoop', 'Airflow', 'dbt', 'Snowflake', 'Databricks', 'BigQuery', 'Redshift', 'Cassandra',
  'DynamoDB', 'Elasticsearch', 'OpenSearch', 'Prometheus', 'Grafana', 'Datadog', 'Splunk',
  'Jenkins', 'CircleCI', 'GitLab CI', 'ArgoCD', 'Helm', 'Istio', 'Go', 'Golang', 'Rust', 'Java',
  'Scala', 'Kotlin', 'Swift', 'Ruby', 'Rails', 'PHP', 'Laravel', 'Symfony', 'Django', 'Flask',
  'FastAPI', 'Spring Boot', 'ASP.NET', '.NET', 'C#', 'C++', 'Objective-C', 'Perl', 'Elixir',
  'Erlang', 'Haskell', 'Clojure', 'R', 'MATLAB', 'Julia', 'Vue', 'Angular', 'Svelte', 'Ember',
  'jQuery', 'Redux', 'GraphQL', 'gRPC', 'REST', 'WebSocket', 'WebGL', 'Three.js', 'Storybook',
  'Playwright', 'Cypress', 'Selenium', 'Jest', 'Vitest', 'Mocha', 'JUnit', 'Pytest',
  'TensorFlow', 'PyTorch', 'Keras', 'scikit-learn', 'Pandas', 'NumPy', 'Hugging Face',
  'LangChain', 'OpenAI', 'MongoDB', 'MySQL', 'PostgreSQL', 'Redis', 'SQLite', 'Oracle',
  'SQL Server', 'Neo4j', 'Memcached', 'Docker', 'Nginx', 'Linux', 'Bash', 'PowerShell',
  'Webpack', 'Vite', 'Tailwind CSS', 'Sass', 'Flutter', 'React Native', 'Android', 'iOS',
  'Unity', 'Unreal', 'Salesforce', 'SAP', 'ServiceNow', 'Tableau', 'Power BI', 'Looker',
  'Figma', 'Jira', 'Confluence', 'Next.js', 'Nuxt', 'Remix', 'Express', 'NestJS', 'Node.js',
  'React', 'TypeScript', 'JavaScript', 'Python', 'CI/CD', 'GitHub Actions', 'Git', 'Stripe',
  'Twilio', 'Firebase', 'Supabase', 'Vercel', 'Heroku', 'Cloudflare', 'Lambda', 'S3', 'EC2',
  'Kinesis', 'Pulumi', 'Vault', 'Consul', 'OpenTelemetry', 'Sentry', 'New Relic', 'Solidity',
];

// Bare forms that collide with ordinary English words. They only match with
// the exact capitalization used in the vocabulary.
const COMMON_WORD_TERMS = new Set([
  'go', 'r', 'c', 'next', 'express', 'spark', 'swift', 'rust', 'ruby', 'flask', 'rails', 'ember',
  'react', 'node', 'vault', 'unity', 'redux', 'lambda', 'oracle', 'android', 'bash', 'git', 'rest',
  'remix', 'helm', 'nest', 'spring', 'jest', 'mocha', 'ray', 'stripe',
]);

// Single words that appear in job-description skill lists but are practices or
// qualities, not technologies. Matching them would flag ordinary prose.
const GENERIC_JD_WORDS = new Set([
  'communication', 'leadership', 'collaboration', 'mentoring', 'ownership', 'testing', 'debugging',
  'analytics', 'analysis', 'documentation', 'agile', 'scrum', 'kanban', 'security', 'performance',
  'scalability', 'reliability', 'automation', 'monitoring', 'observability', 'networking', 'cloud',
  'devops', 'backend', 'frontend', 'fullstack', 'microservices', 'architecture', 'design', 'planning',
  'research', 'writing', 'management', 'strategy', 'support', 'optimization', 'modeling', 'statistics',
  'accessibility', 'teamwork', 'problem-solving', 'creativity', 'curiosity', 'rigor', 'humility',
]);

/**
 * Whether a job-description skill phrase is specific enough to count as a
 * technology name. Multi-word phrases ("Data Analysis", "Bug reproduction")
 * are skills or practices, so they are excluded; the judge covers those.
 */
export function looksLikeTechTerm(term: string): boolean {
  const t = term.trim();
  if (!t || /\s/.test(t) || /^[A-Za-z]+-[a-z]+$/.test(t)) return false;
  if (/[0-9.+#]/.test(t) || /^[A-Z0-9]{2,6}$/.test(t) || /[a-z][A-Z]/.test(t)) return true;
  return /^[A-Z]/.test(t) && t.length >= 3 && !GENERIC_JD_WORDS.has(t.toLowerCase());
}

export interface VocabEntry {
  key: string;
  label: string;
  regexes: RegExp[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function surfaceForms(term: string): Array<{ form: string; exactCase: boolean }> {
  const base = term.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  const forms = new Map<string, boolean>([[base, false]]);
  const unversioned = base.replace(/\s+v?\d+(\.\d+)*$/, '').trim();
  if (!forms.has(unversioned)) forms.set(unversioned, false);
  // "Three.js" -> "Three" would match the English word, so the bare form is case-sensitive.
  if (/\.js$/i.test(unversioned)) forms.set(unversioned.replace(/\.js$/i, ''), true);
  return [...forms.entries()]
    .filter(([f]) => f.length >= 1 && f.length <= 40)
    .map(([form, exactCase]) => ({ form, exactCase }));
}

function buildRegex(form: string, exactCase: boolean): RegExp {
  const caseSensitive = exactCase || form.length <= 3 || COMMON_WORD_TERMS.has(form.toLowerCase());
  return new RegExp(
    `(?<![A-Za-z0-9_#+.])${escapeRegex(form)}(?![A-Za-z0-9_#+]|\\.[A-Za-z0-9])`,
    caseSensitive ? '' : 'i',
  );
}

/** Builds the detection vocabulary: one entry per canonical key, all its surface forms. */
export function buildVocabulary(terms: Iterable<string>): VocabEntry[] {
  const byKey = new Map<string, VocabEntry>();
  for (const term of terms) {
    const trimmed = term.trim();
    if (trimmed.length < 1 || trimmed.length > 40 || /[,:;]/.test(trimmed)) continue;
    const key = techKey(trimmed);
    if (!key) continue;
    const entry = byKey.get(key) ?? { key, label: trimmed, regexes: [] };
    for (const { form, exactCase } of surfaceForms(trimmed)) entry.regexes.push(buildRegex(form, exactCase));
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/** Keys of every vocabulary technology mentioned in `text`. */
export function detectTech(text: string, vocab: readonly VocabEntry[]): Set<string> {
  const found = new Set<string>();
  for (const v of vocab) {
    if (v.regexes.some((re) => re.test(text))) found.add(v.key);
  }
  return found;
}
