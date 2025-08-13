module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/core', '<rootDir>/protocols'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
        moduleResolution: 'node',
        resolveJsonModule: true,
        strict: true,
        paths: {
          '@protocols/*': ['./protocols/src/*'],
          '@core/*': ['./core/src/*']
        }
      }
    }]
  },
  moduleNameMapper: {
    '^@protocols/(.*)$': '<rootDir>/protocols/src/$1',
    '^@core/(.*)$': '<rootDir>/core/src/$1'
  },
  collectCoverage: true,
  collectCoverageFrom: [
    'core/src/**/*.{ts,tsx}',
    'protocols/src/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/tests/**'
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 10000,
  verbose: true,
  maxWorkers: '50%',
  globals: {
    'ts-jest': {
      isolatedModules: false
    }
  }
};