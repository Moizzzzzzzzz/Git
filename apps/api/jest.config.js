/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: '(src|test)/.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }] },
  moduleNameMapper: {
    '^@fabricqc/shared$': '<rootDir>/../../packages/shared/src',
    '^@fabricqc/quality-engine$': '<rootDir>/../../packages/quality-engine/src',
  },
  globalSetup: '<rootDir>/test/global-setup.js',
  setupFiles: ['<rootDir>/test/setup-env.js'],
  testTimeout: 30000,
};
