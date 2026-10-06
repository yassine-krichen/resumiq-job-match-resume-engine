import { extractNumbers } from './text-utils';

describe('extractNumbers', () => {
  it.each([
    ['grew by .5 percent', ['0.5']],
    ['processed 1,200 tickets', ['1200']],
    ['processed 1200 tickets', ['1200']],
    ['moved from 1.2.3 to 1.2.4', ['1.2.3', '1.2.4']],
    ['saved 1,5 hours', ['1.5']],
    ['kept 2.50 and 2.5', ['2.5', '2.5']],
    ['08:30 and 8:30', ['8', '30', '8', '30']],
  ])('reads "%s"', (text, expected) => {
    expect(extractNumbers(text)).toEqual(expected);
  });

  it('ignores digits glued to letters, such as S3, k8s and OAuth2', () => {
    expect(extractNumbers('stored in S3, ran on k8s with OAuth2')).toEqual([]);
  });

  it('does not read a sentence-final period as part of the number', () => {
    expect(extractNumbers('Served 40 teams.')).toEqual(['40']);
  });
});
