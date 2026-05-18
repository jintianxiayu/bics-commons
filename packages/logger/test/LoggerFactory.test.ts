/**
 * LoggerFactory 单元测试
 */

import { LoggerFactory } from '../src/core/LoggerFactory';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import * as path from 'path';

const TEST_CONFIG_PATH = path.join(__dirname, 'test-logger-factory-config.yaml');

describe('LoggerFactory', () => {
  beforeEach(() => {
    LoggerFactory.reset();
  });

  afterEach(async () => {
    await LoggerFactory.shutdown();
    if (existsSync(TEST_CONFIG_PATH)) {
      try {
        unlinkSync(TEST_CONFIG_PATH);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe('init', () => {
    it('should initialize with valid config when env var is set', () => {
      const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
      writeFileSync(TEST_CONFIG_PATH, yaml);

      const originalPath = process.env.LOGGER_CONFIG_PATH;
      process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
      try {
        expect(() => LoggerFactory.init()).not.toThrow();
      } finally {
        if (originalPath !== undefined) {
          process.env.LOGGER_CONFIG_PATH = originalPath;
        } else {
          delete process.env.LOGGER_CONFIG_PATH;
        }
      }
    });

    it('should throw on invalid config', () => {
      const yaml = `
root:
  level: invalid
`;
      writeFileSync(TEST_CONFIG_PATH, yaml);

      const originalPath = process.env.LOGGER_CONFIG_PATH;
      process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
      try {
        expect(() => LoggerFactory.init()).toThrow();
      } finally {
        if (originalPath !== undefined) {
          process.env.LOGGER_CONFIG_PATH = originalPath;
        } else {
          delete process.env.LOGGER_CONFIG_PATH;
        }
      }
    });

    it('should throw on non-existent config file when no default exists', () => {
      const originalPath = process.env.LOGGER_CONFIG_PATH;
      delete process.env.LOGGER_CONFIG_PATH;
      LoggerFactory.reset();
      try {
        expect(() => LoggerFactory.init()).toThrow();
      } finally {
        if (originalPath !== undefined) {
          process.env.LOGGER_CONFIG_PATH = originalPath;
        }
      }
    });
  });

  describe('getLogger', () => {
    it('should return logger instance with all log methods', () => {
      const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
      writeFileSync(TEST_CONFIG_PATH, yaml);

      const logger = LoggerFactory.getLogger('test');

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should return logger that can be used multiple times', () => {
      const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
      writeFileSync(TEST_CONFIG_PATH, yaml);

      const logger = LoggerFactory.getLogger('multi-use');

      // Should not throw when called multiple times
      expect(() => logger.info('message 1')).not.toThrow();
      expect(() => logger.info('message 2')).not.toThrow();
    });

    it('should return different loggers for different names', () => {
      const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
      writeFileSync(TEST_CONFIG_PATH, yaml);

      const logger1 = LoggerFactory.getLogger('logger1');
      const logger2 = LoggerFactory.getLogger('logger2');

      // They should be different references (different objects)
      expect(logger1).not.toBe(logger2);
    });
  });

  describe('shutdown', () => {
    it('should complete without error', async () => {
      const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
      writeFileSync(TEST_CONFIG_PATH, yaml);

      LoggerFactory.getLogger('test');

      await expect(LoggerFactory.shutdown()).resolves.not.toThrow();
    });

    it('should handle multiple calls gracefully', async () => {
      const yaml = `
root:
  level: info
  console:
    enabled: true
  file:
    enabled: false
`;
      writeFileSync(TEST_CONFIG_PATH, yaml);

      LoggerFactory.getLogger('test');

      await LoggerFactory.shutdown();
      // Second call should also not throw
      await expect(LoggerFactory.shutdown()).resolves.not.toThrow();
    });
  });

  describe('setupShutdownHandlers', () => {
    it('should register signal handlers without error', () => {
      expect(() => LoggerFactory.setupShutdownHandlers()).not.toThrow();
    });
  });

  describe('reset', () => {
    it('should clear internal state', () => {
      LoggerFactory.reset();
      // After reset, getting a logger should reinitialize
      expect(() => LoggerFactory.getLogger('after-reset')).not.toThrow();
    });
  });
});