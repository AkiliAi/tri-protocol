module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/unit/core/**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/tests/unit/core/jest.setup.ts'],
    moduleNameMapper: {
        '^@core/(.*)$': '<rootDir>/core/src/$1',
        '^@protocols/(.*)$': '<rootDir>/protocols/src/$1',
        '^@logger/(.*)$': '<rootDir>/logger/src/$1',
        '^@tri-protocol/logger$': '<rootDir>/logger/src/index.ts'
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                moduleResolution: 'node',
                target: 'ES2022',
                module: 'commonjs',
                strict: true,
                skipLibCheck: true
            }
        }]
    },
    testTimeout: 10000,
    rootDir: '../../../'
};