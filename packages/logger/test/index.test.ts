import { LoggerFactory } from '../src/index';

describe('LoggerFactory', () => {
  afterEach(() => {
    LoggerFactory.reset();
  });

  it('should get logger with default config', () => {
    const logger = LoggerFactory.getLogger('test');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should return same logger for same name', () => {
    const logger1 = LoggerFactory.getLogger('test');
    const logger2 = LoggerFactory.getLogger('test');
    expect(logger1).toBe(logger2);
  });
});