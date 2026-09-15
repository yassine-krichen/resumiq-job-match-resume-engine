import { BadRequestException } from '@nestjs/common';
import { MasterDBSchema } from '@resumiq/schemas';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().min(18),
  });

  it('returns the parsed/typed data when the input is valid', () => {
    const pipe = new ZodValidationPipe(schema);
    const input = { email: 'user@example.com', age: 25 };

    expect(pipe.transform(input)).toEqual(input);
  });

  it('throws BadRequestException with a sanitized {path, message} shape when the input is invalid', () => {
    const pipe = new ZodValidationPipe(schema);
    const input = { email: 'not-an-email', age: 10 };

    try {
      pipe.transform(input);
      fail('expected transform to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);

      const response = (error as BadRequestException).getResponse() as {
        message: Array<{ path: string; message: string }>;
      };
      const issues = response.message;

      expect(Array.isArray(issues)).toBe(true);
      for (const issue of issues) {
        expect(Object.keys(issue).sort()).toEqual(['message', 'path']);
      }

      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain('ZodIssue');
      expect(serialized).not.toContain('"code"');
      expect(serialized).not.toContain('"expected"');
      expect(serialized).not.toContain('"received"');
    }
  });

  it('throws BadRequestException (not a raw ZodError) for a MasterDBSchema payload exceeding the experience count cap', () => {
    const pipe = new ZodValidationPipe(MasterDBSchema);
    const oversizedMasterDB = {
      personal_info: {
        name: 'Jane Doe',
        location: 'Remote',
        phone: '555-1234',
        email: 'jane@example.com',
        work_authorization: [],
        clearances: [],
        links: [],
      },
      summaries: [],
      experience: Array.from({ length: 51 }, (_, i) => ({
        company: `Company-${i}`,
        company_industry: 'Software',
        role: 'Engineer',
        location: 'Remote',
        location_type: 'Remote',
        startDate: '2023',
        endDate: '2023',
        isCurrent: false,
        core_competencies: [],
        technologies_used: [],
        raw_achievements: [],
        quantifiable_metrics: [],
      })),
      education: [],
      projects: [],
      skills: {
        programming_languages: [],
        frameworks_and_libraries: [],
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

    expect(() => pipe.transform(oversizedMasterDB)).toThrow(BadRequestException);
  });
});
