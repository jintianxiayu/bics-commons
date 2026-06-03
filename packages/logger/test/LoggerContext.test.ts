/**
 * LoggerContext 单元测试
 */

import { LoggerContext } from '../src/core/LoggerContext';

describe('LoggerContext', () => {
    afterEach(() => {
        LoggerContext.clear();
    });

    describe('set/get', () => {
        it('should set and get value', () => {
            LoggerContext.set('traceId', 'abc123');
            expect(LoggerContext.get('traceId')).toBe('abc123');
        });

        it('should overwrite existing value', () => {
            LoggerContext.set('traceId', 'old-value');
            LoggerContext.set('traceId', 'new-value');
            expect(LoggerContext.get('traceId')).toBe('new-value');
        });

        it('should set multiple values', () => {
            LoggerContext.set('traceId', 't1');
            LoggerContext.set('userId', 'u1');
            expect(LoggerContext.get('traceId')).toBe('t1');
            expect(LoggerContext.get('userId')).toBe('u1');
        });
    });

    describe('get', () => {
        it('should return undefined for non-existent key', () => {
            expect(LoggerContext.get('nonexistent')).toBeUndefined();
        });
    });

    describe('clear', () => {
        it('should clear all values', () => {
            LoggerContext.set('traceId', 'abc123');
            LoggerContext.set('userId', 'u1');
            LoggerContext.clear();
            expect(LoggerContext.get('traceId')).toBeUndefined();
            expect(LoggerContext.get('userId')).toBeUndefined();
        });
    });

    describe('withContext', () => {
        it('should provide values to nested code', () => {
            const result = LoggerContext.withContext({ traceId: 't1' }, () => {
                return LoggerContext.get('traceId');
            });
            expect(result).toBe('t1');
        });

        it('should preserve outer context', () => {
            LoggerContext.set('userId', 'u1');
            const result = LoggerContext.withContext({ traceId: 't1' }, () => {
                return {
                    traceId: LoggerContext.get('traceId'),
                    userId: LoggerContext.get('userId'),
                };
            });
            expect(result.traceId).toBe('t1');
            expect(result.userId).toBe('u1');
        });

        it('should clean up after execution', () => {
            LoggerContext.withContext({ traceId: 't1' }, () => {
                // inside context
            });
            expect(LoggerContext.get('traceId')).toBeUndefined();
        });

        it('should clean up on exception', () => {
            try {
                LoggerContext.withContext({ traceId: 't1' }, () => {
                    throw new Error('test');
                });
            } catch {
                // ignore
            }
            expect(LoggerContext.get('traceId')).toBeUndefined();
        });

        it('should allow nested withContext', () => {
            const result = LoggerContext.withContext({ a: '1' }, () => {
                return LoggerContext.withContext({ b: '2' }, () => {
                    return {
                        a: LoggerContext.get('a'),
                        b: LoggerContext.get('b'),
                    };
                });
            });
            expect(result.a).toBe('1');
            expect(result.b).toBe('2');
        });

        it('should allow nested withContext to override', () => {
            const result = LoggerContext.withContext({ a: '1' }, () => {
                return LoggerContext.withContext({ a: '2' }, () => {
                    return LoggerContext.get('a');
                });
            });
            expect(result).toBe('2');
        });
    });
});
