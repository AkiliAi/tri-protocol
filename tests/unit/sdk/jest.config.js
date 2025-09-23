module.exports = {
  displayName: 'SDK Unit Tests',
  testEnvironment: 'node',
  rootDir: '../../../',
  testMatch: [
    '<rootDir>/tests/unit/sdk/**/*.test.ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  moduleNameMapper: {
    '^@sdk/(.*)$': '<rootDir>/sdk/src/$1',
    '^@core/(.*)$': '<rootDir>/core/src/$1',
    '^@protocols/(.*)$': '<rootDir>/protocols/src/$1',
    '^@logger/(.*)$': '<rootDir>/logger/src/$1'
  },
  collectCoverageFrom: [
    'sdk/src/**/*.ts',
    '!sdk/src/**/*.d.ts',
    '!sdk/src/**/*.test.ts',
    '!sdk/src/**/index.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: [
    '<rootDir>/tests/unit/sdk/jest.setup.ts'
  ],
  testTimeout: 10000,
  verbose: true,
  bail: false,
  clearMocks: true,
  restoreMocks: true,
  coverageDirectory: '<rootDir>/coverage/sdk',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ]
};