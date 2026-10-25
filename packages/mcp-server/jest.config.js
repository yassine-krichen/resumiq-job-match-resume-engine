/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  // ts-jest only transpiles here (isolatedModules is set in tsconfig.json); `tsc --noEmit` is the type check.
  transform: { '^.+\\.ts$': 'ts-jest' },
};
