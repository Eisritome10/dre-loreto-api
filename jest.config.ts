import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testRegex: 'src/.*\.spec\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
  testEnvironment: 'node',
};

export default config;
