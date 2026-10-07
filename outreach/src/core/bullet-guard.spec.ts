import type { MasterDB } from '../resume/master-db';
import type { OutreachTailoring } from '../schemas/outreach';

import { masterDb } from './__fixtures__/outreach-fixtures';
import { guardTailoring } from './bullet-guard';
import type { GuardOptions } from './bullet-guard';

function tailoringWithBullet(text: string, overrides: Partial<OutreachTailoring> = {}): OutreachTailoring {
  return {
    summary: 'Full-stack engineer who ships reliable internal tools.',
    entries: [
      { kind: 'project', name: 'TickIT', bullets: [{ text, source_entry: 'TickIT' }] },
      {
        kind: 'experience',
        name: 'Acme Corp',
        bullets: [
          {
            text: 'Built an internal dashboard in Java for the field operations team.',
            source_entry: 'Acme Corp',
          },
        ],
      },
    ],
    skills: {
      programming_languages: ['TypeScript'],
      frameworks_and_libraries: ['Spring Boot'],
      infrastructure_and_tools: [],
      databases: ['PostgreSQL'],
    },
    ...overrides,
  };
}

function rules(tailoring: OutreachTailoring, db: MasterDB = masterDb, options?: GuardOptions): string[] {
  return guardTailoring(tailoring, db, options).violations.map((violation) => violation.rule);
}

function withTickItTech(extra: string[]): MasterDB {
  return {
    ...masterDb,
    projects: masterDb.projects.map((project) =>
      project.name === 'TickIT' ? { ...project, technologies_used: [...project.technologies_used, ...extra] } : project,
    ),
  };
}

describe('guardTailoring', () => {
  it('passes a rewritten bullet that only reuses real numbers and the entry technologies', () => {
    const result = guardTailoring(
      tailoringWithBullet('Replaced an email-and-file workflow for a 40-person team with a Spring Boot and Angular app.'),
      masterDb,
    );

    expect(result).toEqual({ pass: true, violations: [] });
  });

  it('rejects a number that is not in the cited entry', () => {
    const result = guardTailoring(tailoringWithBullet('Cut ticket handling time by 35% for the operations team.'), masterDb);

    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({ rule: 'invented_number', detail: expect.stringContaining('35') }),
    ]);
  });

  it('accepts the same number written differently (12,000 vs 12000)', () => {
    expect(rules(tailoringWithBullet('Migrated 12000 historical cases into structured tickets.'))).toEqual([]);
  });

  it('rejects a number that exists in another entry but not the cited one', () => {
    // "15 minutes" belongs to Acme Corp, not TickIT.
    expect(rules(tailoringWithBullet('Reduced report time to 15 minutes.'))).toEqual(['invented_number']);
  });

  it('rejects a technology the profile knows but the cited entry does not list', () => {
    const result = guardTailoring(tailoringWithBullet('Built the ticketing backend with NestJS and PostgreSQL.'), masterDb);

    expect(result.violations).toEqual([
      expect.objectContaining({ rule: 'technology_not_in_source', detail: expect.stringContaining('NestJS') }),
    ]);
  });

  it('rejects a language borrowed from another entry', () => {
    expect(rules(tailoringWithBullet('Wrote the ticket importer in TypeScript.'))).toEqual(['technology_not_in_source']);
  });

  it('does not count "Spring" separately inside "Spring Boot"', () => {
    expect(rules(tailoringWithBullet('Delivered the ticketing API with Spring Boot.'))).toEqual([]);
  });

  it('does not mistake ordinary words or identifiers for technologies or numbers', () => {
    // "next" the word, "Java" inside "JavaScript"-like words, digits glued to letters (S3).
    expect(rules(tailoringWithBullet('Planned the next release and stored attachments in S3 for the 40-person team.'))).toEqual(
      [],
    );
  });

  it('flags a bullet that cites a different entry than the one it sits under', () => {
    const tailoring = tailoringWithBullet('Delivered the ticketing API with Spring Boot.');
    tailoring.entries[0].bullets[0].source_entry = 'Resume Engine';

    expect(rules(tailoring)).toEqual(['source_entry_mismatch']);
  });

  it('flags an entry that is not in data_inventory', () => {
    const tailoring = tailoringWithBullet('Delivered the ticketing API with Spring Boot.');
    tailoring.entries[0].name = 'Imaginary Project';
    tailoring.entries[0].bullets[0].source_entry = 'Imaginary Project';

    expect(rules(tailoring)).toEqual(['unknown_source_entry']);
  });

  it('rejects a skill that is not one of the user skills and accepts spelling variants of real ones', () => {
    const bad = tailoringWithBullet('Delivered the ticketing API with Spring Boot.', {
      skills: { programming_languages: [], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: ['Redis'] },
    });
    const variant = tailoringWithBullet('Delivered the ticketing API with Spring Boot.', {
      skills: {
        programming_languages: ['typescript'],
        frameworks_and_libraries: ['NextJS', 'springboot'],
        infrastructure_and_tools: [],
        databases: [],
      },
    });

    expect(rules(bad)).toEqual(['skill_not_in_profile']);
    expect(rules(variant)).toEqual([]);
  });

  describe('technology versions', () => {
    it('ignores the digits of a versioned name only when the profile lists exactly that name', () => {
      const db = withTickItTech(['Angular 17']);

      expect(rules(tailoringWithBullet('Built the ticketing UI with Angular 17 for the 40-person team.'), db)).toEqual([]);
    });

    it('flags "Angular 17" when the profile only lists "Angular"', () => {
      expect(rules(tailoringWithBullet('Built the ticketing UI with Angular 17 for the 40-person team.'))).toEqual([
        'invented_number',
      ]);
    });

    it('does not let a technology name that contains a number whitelist that number elsewhere', () => {
      const db = withTickItTech(['Angular 17']);

      expect(rules(tailoringWithBullet('Cut ticket handling time by 17% for the operations team.'), db)).toEqual([
        'invented_number',
      ]);
    });

    it('flags a percentage written right after a technology name', () => {
      expect(rules(tailoringWithBullet('Cut latency with PostgreSQL 60%'))).toEqual(['invented_number']);
    });

    it('flags a quantity written right after a technology name', () => {
      expect(rules(tailoringWithBullet('Moved PostgreSQL 3 million rows into structured tickets.'))).toEqual([
        'invented_number',
      ]);
    });

    it('flags a quantity after a technology name in the summary', () => {
      const tailoring = tailoringWithBullet('Delivered the ticketing API with Spring Boot.', {
        summary: 'Engineer whose PostgreSQL 5 services handle 12,000 cases for the team.',
      });

      expect(guardTailoring(tailoring, masterDb).violations).toEqual([
        expect.objectContaining({ rule: 'invented_number', where: 'summary', detail: expect.stringContaining('"5"') }),
      ]);
    });

    it('does not strip the digits of a listed versioned name when they read as a quantity', () => {
      const db = withTickItTech(['Angular 17']);

      expect(rules(tailoringWithBullet('Shipped Angular 17% faster pages to the 40-person team.'), db)).toEqual([
        'invented_number',
      ]);
    });
  });

  describe('technology aliases', () => {
    it.each([
      ['Postgres', 'Stored tickets in Postgres for the 40-person team.'],
      ['PostgreSQL', 'Stored tickets in PostgreSQL for the 40-person team.'],
    ])('accepts the spelling %s of a listed PostgreSQL', (_name, bullet) => {
      expect(rules(tailoringWithBullet(bullet))).toEqual([]);
    });

    it('accepts an alias of a profile technology in either direction and does not call it foreign', () => {
      const db: MasterDB = {
        ...masterDb,
        skills: { ...masterDb.skills, programming_languages: ['TS', 'JS', 'Python'], infrastructure_and_tools: ['K8s'] },
        projects: masterDb.projects.map((project) =>
          project.name === 'TickIT'
            ? { ...project, technologies_used: ['Mongo', 'TypeScript', 'Kubernetes', 'Node.js'] }
            : project,
        ),
      };

      expect(rules(tailoringWithBullet('Built the TickIT API in TypeScript and Node on Kubernetes with MongoDB.'), db)).toEqual([]);
      expect(rules(tailoringWithBullet('Built the TickIT API in TS and K8s with Mongo.'), db)).toEqual([]);
    });

    it('still flags an alias of a technology the profile does not list, or lists only under another entry', () => {
      expect(rules(tailoringWithBullet('Deployed the ticketing app on K8s.'))).toEqual(['foreign_technology']);
      expect(rules(tailoringWithBullet('Stored tickets in Mongo.'))).toEqual(['technology_not_in_source']);
    });

    it('flags a listed alias used under an entry that does not list the technology', () => {
      // Resume Engine lists TypeScript; TickIT does not.
      expect(rules(tailoringWithBullet('Wrote the ticket importer in TS.'))).toEqual(['technology_not_in_source']);
    });

    it('does not read the word "ts" or "js" in lowercase as a technology', () => {
      expect(rules(tailoringWithBullet('Wrote the ticketing API with Spring Boot, then ran the .ts and .js checks.'))).toEqual(
        [],
      );
    });
  });

  describe('summary', () => {
    it('rejects a number in the summary that no selected entry supports', () => {
      const tailoring = tailoringWithBullet('Delivered the ticketing API with Spring Boot.', {
        summary: 'Engineer with 7 years of experience shipping reliable internal tools.',
      });

      expect(guardTailoring(tailoring, masterDb).violations).toEqual([
        expect.objectContaining({ rule: 'invented_number', where: 'summary' }),
      ]);
    });

    it('rejects a technology in the summary that no selected entry or shown skill has', () => {
      const tailoring = tailoringWithBullet('Delivered the ticketing API with Spring Boot.', {
        summary: 'Engineer who ships reliable internal tools with NestJS and Spring Boot.',
      });

      expect(guardTailoring(tailoring, masterDb).violations).toEqual([
        expect.objectContaining({ rule: 'technology_not_in_source', where: 'summary', detail: expect.stringContaining('NestJS') }),
      ]);
    });

    it('accepts a summary built from the selected entries, their numbers and the shown skills', () => {
      const tailoring = tailoringWithBullet('Delivered the ticketing API with Spring Boot.', {
        summary: 'Engineer who replaced a manual workflow for a 40-person team using Java and Spring Boot.',
      });

      expect(rules(tailoring)).toEqual([]);
    });
  });

  describe('foreign technologies', () => {
    it('flags a common technology the user has never listed', () => {
      expect(rules(tailoringWithBullet('Deployed the ticketing app on Kubernetes.'))).toEqual(['foreign_technology']);
    });

    it('flags a technology the researcher found in the company stack', () => {
      const tailoring = tailoringWithBullet('Integrated ticketing with FleetOS dispatch.');

      expect(rules(tailoring, masterDb, { foreignTerms: ['FleetOS'] })).toEqual(['foreign_technology']);
    });

    it('flags a foreign technology in the summary', () => {
      const tailoring = tailoringWithBullet('Delivered the ticketing API with Spring Boot.', {
        summary: 'Engineer who ships reliable internal tools on AWS and Spring Boot.',
      });

      expect(guardTailoring(tailoring, masterDb).violations).toEqual([
        expect.objectContaining({ rule: 'foreign_technology', where: 'summary' }),
      ]);
    });

    it('accepts a common technology that the cited entry really lists', () => {
      expect(rules(tailoringWithBullet('Deployed the ticketing app on Kubernetes.'), withTickItTech(['Kubernetes']))).toEqual([]);
    });

    it('does not mistake ordinary words such as "react" for technologies', () => {
      expect(rules(tailoringWithBullet('Learned to react quickly to production incidents on the ticketing app.'))).toEqual([]);
    });
  });
});
