import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    // Scalar's ESM-only client bundle can't be loaded by Jest's CJS runtime and the
    // e2e suite never renders the /docs UI — stub it. See test/helpers/scalar-stub.ts.
    '^@scalar/nestjs-api-reference$': '<rootDir>/test/helpers/scalar-stub.ts',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
    '^@app/(.*)$': '<rootDir>/src/$1',
  },
  testEnvironment: 'node',
  testTimeout: 30000,
  forceExit: true,
  globalSetup: '<rootDir>/test/helpers/global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/test/helpers/setup-e2e.ts'],
};

export default config;
