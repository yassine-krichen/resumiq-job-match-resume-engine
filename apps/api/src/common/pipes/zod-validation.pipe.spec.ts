import { BadRequestException } from '@nestjs/common';
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
});
