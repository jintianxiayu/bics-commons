/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/test'],
    testMatch: ['**/test/**/*.test.ts'],
    testTimeout: 15000,
    moduleFileExtensions: ['ts', 'js'],
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../../tsconfig.test.json' }],
    },
};
