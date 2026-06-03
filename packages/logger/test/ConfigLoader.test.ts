/**
 * ConfigLoader 单元测试
 */

import { ConfigLoader } from '../src/core/ConfigLoader';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import * as path from 'path';

const TEST_CONFIG_PATH = path.join(__dirname, 'test-logger-config.yaml');

describe('ConfigLoader', () => {
    beforeEach(() => {
        ConfigLoader.reset();
    });

    afterEach(() => {
        if (existsSync(TEST_CONFIG_PATH)) {
            unlinkSync(TEST_CONFIG_PATH);
        }
    });

    describe('load', () => {
        it('should load valid YAML config', () => {
            const yaml = `
root:
  level: debug
  pattern: '%{timestamp} %{level} %{message}'
  console:
    enabled: true
    colors: true
  file:
    enabled: false
loggers:
  database:
    level: info
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            const config = ConfigLoader.load(TEST_CONFIG_PATH);

            expect(config.level).toBe('debug');
            expect(config.pattern).toBe('%{timestamp} %{level} %{message}');
        });

        it('should throw ConfigError for non-existent file', () => {
            expect(() => ConfigLoader.load('/nonexistent/path.yaml')).toThrow();
        });

        it('should throw ConfigError for invalid YAML', () => {
            const invalidYaml = `
root:
  level: invalid_level
`;
            writeFileSync(TEST_CONFIG_PATH, invalidYaml);

            expect(() => ConfigLoader.load(TEST_CONFIG_PATH)).toThrow();
        });
    });

    describe('getConfig', () => {
        it('should return cached config after load', () => {
            const yaml = `
root:
  level: warn
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            ConfigLoader.load(TEST_CONFIG_PATH);
            const cached = ConfigLoader.getConfig();

            expect(cached).not.toBeNull();
            expect(cached?.level).toBe('warn');
        });

        it('should return null before any load', () => {
            expect(ConfigLoader.getConfig()).toBeNull();
        });
    });

    describe('getLoggerConfig', () => {
        it('should return specific logger config when exists', () => {
            const yaml = `
root:
  level: info
loggers:
  db:
    level: debug
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            ConfigLoader.load(TEST_CONFIG_PATH);
            const dbConfig = ConfigLoader.getLoggerConfig('db');

            expect(dbConfig).not.toBeNull();
            expect(dbConfig?.level).toBe('debug');
        });

        it('should return null for non-existent logger', () => {
            const yaml = `
root:
  level: info
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            ConfigLoader.load(TEST_CONFIG_PATH);
            const nonExistent = ConfigLoader.getLoggerConfig('nonexistent');

            expect(nonExistent).toBeNull();
        });
    });

    describe('getDefaultConfig', () => {
        it('should return default configuration', () => {
            const defaultConfig = ConfigLoader.getDefaultConfig();

            expect(defaultConfig.level).toBe('info');
            expect(defaultConfig.console?.enabled).toBe(true);
            expect(defaultConfig.file?.enabled).toBe(false);
        });
    });

    describe('reset', () => {
        it('should clear cached config', () => {
            const yaml = `
root:
  level: info
`;
            writeFileSync(TEST_CONFIG_PATH, yaml);

            ConfigLoader.load(TEST_CONFIG_PATH);
            expect(ConfigLoader.getConfig()).not.toBeNull();

            ConfigLoader.reset();
            expect(ConfigLoader.getConfig()).toBeNull();
        });
    });
});
