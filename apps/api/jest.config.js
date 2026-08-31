/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  // @nestjs/bullmq and @nestjs/bull-shared ship ESM-only builds (their
  // package.json sets "type": "module", no CJS fallback). Jest's default
  // CJS loader can't parse their `export` syntax, so unlike the rest of
  // node_modules they must be transpiled instead of ignored. Jest
  // auto-normalizes '/' in transformIgnorePatterns for the current OS'
  // path separator, so this stays POSIX-style.
  transformIgnorePatterns: [
    'node_modules/(?!(@nestjs/bullmq|@nestjs/bull-shared)/)',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {}],
    // transform keys (unlike transformIgnorePatterns) are matched
    // against the raw OS path as-is, so '.' stands in for the path
    // separator to work on both POSIX ('/') and Windows ('\').
    '@nestjs.(bullmq|bull-shared).+\\.js$': [
      'ts-jest',
      { isolatedModules: true },
    ],
  },
};
