/**
 * LoggerContext 单元测试
 */

import { LoggerContext } from '../src/core/LoggerContext';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
    reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: Deferred<T>['resolve'];
    let reject!: Deferred<T>['reject'];
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('LoggerContext', () => {
    afterEach(() => {
        LoggerContext.clear();
    });

    describe('scope requirements and validation', () => {
        it('does not create ambient context for get or clear', async () => {
            expect(LoggerContext.get('traceId')).toBeUndefined();
            expect(LoggerContext.getStore()).toBeUndefined();
            expect(() => LoggerContext.clear()).not.toThrow();
            await Promise.resolve();
            expect(LoggerContext.getStore()).toBeUndefined();
        });

        it('rejects set outside withContext without creating ambient context', async () => {
            expect(() => LoggerContext.set('traceId', 'abc123')).toThrow(/withContext/);
            await Promise.resolve();
            expect(LoggerContext.get('traceId')).toBeUndefined();
            expect(LoggerContext.getStore()).toBeUndefined();
        });

        it.each([[''], ['   '], [1], [null]])('rejects invalid get key %p', (key) => {
            expect(() => LoggerContext.get(key as string)).toThrow(TypeError);
        });

        it('validates set parameters before checking for an active scope', () => {
            expect(() => LoggerContext.set('', 'value')).toThrow(TypeError);
            expect(() => LoggerContext.set('traceId', 1 as unknown as string)).toThrow(TypeError);
        });

        it('accepts an empty string value inside a scope', () => {
            LoggerContext.withContext({}, () => {
                LoggerContext.set('traceId', '');
                expect(LoggerContext.get('traceId')).toBe('');
            });
        });

        it.each([null, [], new Date(), 'values'])('rejects non-plain values object %p', (values) => {
            const callback = jest.fn();
            expect(() => LoggerContext.withContext(values as never, callback)).toThrow(TypeError);
            expect(callback).not.toHaveBeenCalled();
        });

        it('accepts a null-prototype values object', () => {
            const values = Object.create(null) as Record<string, string>;
            values.traceId = 'null-prototype';

            expect(LoggerContext.withContext(values, () => LoggerContext.get('traceId'))).toBe('null-prototype');
        });

        it('rejects invalid values entries atomically', () => {
            LoggerContext.withContext({ traceId: 'outer' }, () => {
                const callback = jest.fn();
                expect(() =>
                    LoggerContext.withContext(
                        { traceId: 'inner', bad: 1 } as unknown as Record<string, string>,
                        callback
                    )
                ).toThrow(TypeError);
                expect(callback).not.toHaveBeenCalled();
                expect(LoggerContext.get('traceId')).toBe('outer');
            });
        });

        it('rejects enumerable symbol keys', () => {
            const values = { [Symbol('traceId')]: 'symbol-value' } as unknown as Record<string, string>;
            expect(() => LoggerContext.withContext(values, () => undefined)).toThrow(TypeError);
        });

        it('propagates a throwing getter without entering the scope', () => {
            const failure = new Error('getter failed');
            const values = Object.defineProperty({}, 'traceId', {
                enumerable: true,
                get(): never {
                    throw failure;
                },
            }) as Record<string, string>;
            const callback = jest.fn();

            expect(() => LoggerContext.withContext(values, callback)).toThrow(failure);
            expect(callback).not.toHaveBeenCalled();
            expect(LoggerContext.getStore()).toBeUndefined();
        });

        it('rejects a non-function callback before reading values', () => {
            const getter = jest.fn(() => 'trace');
            const values = Object.defineProperty({}, 'traceId', { enumerable: true, get: getter });

            expect(() => LoggerContext.withContext(values as Record<string, string>, null as never)).toThrow(TypeError);
            expect(getter).not.toHaveBeenCalled();
        });
    });

    describe('scoped reads and writes', () => {
        it('sets, gets, overwrites and clears values inside a scope', () => {
            LoggerContext.withContext({}, () => {
                LoggerContext.set('traceId', 'old-value');
                LoggerContext.set('traceId', 'new-value');
                LoggerContext.set('userId', 'u1');
                expect(LoggerContext.get('traceId')).toBe('new-value');
                expect(LoggerContext.get('userId')).toBe('u1');

                LoggerContext.clear();
                expect(LoggerContext.get('traceId')).toBeUndefined();
                expect(LoggerContext.get('userId')).toBeUndefined();
            });
        });

        it('preserves and restores nested context', () => {
            LoggerContext.withContext({ traceId: 'outer', tenantId: 't-1' }, () => {
                const nested = LoggerContext.withContext({ traceId: 'inner', userId: 'u-1' }, () => ({
                    traceId: LoggerContext.get('traceId'),
                    tenantId: LoggerContext.get('tenantId'),
                    userId: LoggerContext.get('userId'),
                }));

                expect(nested).toEqual({ traceId: 'inner', tenantId: 't-1', userId: 'u-1' });
                expect(LoggerContext.get('traceId')).toBe('outer');
                expect(LoggerContext.get('tenantId')).toBe('t-1');
                expect(LoggerContext.get('userId')).toBeUndefined();
            });
        });

        it('restores the outer context after a synchronous exception', () => {
            LoggerContext.withContext({ traceId: 'outer' }, () => {
                expect(() =>
                    LoggerContext.withContext({ traceId: 'inner' }, () => {
                        throw new Error('test');
                    })
                ).toThrow('test');
                expect(LoggerContext.get('traceId')).toBe('outer');
            });
        });

        it('propagates through promises and timers and restores after resolve', async () => {
            await LoggerContext.withContext({ traceId: 'async-trace' }, async () => {
                expect(LoggerContext.get('traceId')).toBe('async-trace');
                await Promise.resolve();
                expect(LoggerContext.get('traceId')).toBe('async-trace');
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                expect(LoggerContext.get('traceId')).toBe('async-trace');
            });
            expect(LoggerContext.get('traceId')).toBeUndefined();
        });

        it('restores the outer context after promise rejection', async () => {
            await LoggerContext.withContext({ traceId: 'outer' }, async () => {
                await expect(
                    LoggerContext.withContext({ traceId: 'inner' }, async () => {
                        await Promise.resolve();
                        throw new Error('rejected');
                    })
                ).rejects.toThrow('rejected');
                expect(LoggerContext.get('traceId')).toBe('outer');
            });
        });
    });

    describe('copy-on-write branch isolation', () => {
        it('keeps set changes in the current branch and its future children', async () => {
            await LoggerContext.withContext({ traceId: 'parent' }, async () => {
                await Promise.resolve();
                LoggerContext.set('traceId', 'branch');
                expect(LoggerContext.get('traceId')).toBe('branch');
                await Promise.resolve();
                expect(LoggerContext.get('traceId')).toBe('branch');
            });
            expect(LoggerContext.get('traceId')).toBeUndefined();
        });

        it('isolates interleaved sibling set and clear operations', async () => {
            const start = deferred<void>();
            const branchAChanged = deferred<void>();
            const branchBObserved = deferred<void>();

            await LoggerContext.withContext({ traceId: 'parent', tenantId: 't-1' }, async () => {
                const branchA = (async () => {
                    await start.promise;
                    LoggerContext.set('traceId', 'branch-a');
                    branchAChanged.resolve();
                    await branchBObserved.promise;
                    return {
                        traceId: LoggerContext.get('traceId'),
                        tenantId: LoggerContext.get('tenantId'),
                        childTraceId: await Promise.resolve().then(() => LoggerContext.get('traceId')),
                    };
                })();

                const branchB = (async () => {
                    await start.promise;
                    await branchAChanged.promise;
                    expect(LoggerContext.get('traceId')).toBe('parent');
                    LoggerContext.clear();
                    branchBObserved.resolve();
                    return {
                        traceId: LoggerContext.get('traceId'),
                        tenantId: LoggerContext.get('tenantId'),
                    };
                })();

                start.resolve();
                const [resultA, resultB] = await Promise.all([branchA, branchB]);
                expect(resultA).toEqual({ traceId: 'branch-a', tenantId: 't-1', childTraceId: 'branch-a' });
                expect(resultB).toEqual({ traceId: undefined, tenantId: undefined });
                expect(LoggerContext.get('traceId')).toBe('parent');
                expect(LoggerContext.get('tenantId')).toBe('t-1');
            });
        });
    });

    describe('getStore snapshot', () => {
        it('returns an isolated readonly snapshot', () => {
            LoggerContext.withContext({ traceId: 'snapshot', tenantId: 't-1' }, () => {
                const snapshot: ReadonlyMap<string, string> | undefined = LoggerContext.getStore();
                expect(snapshot?.get('traceId')).toBe('snapshot');
                expect(snapshot?.get('tenantId')).toBe('t-1');

                const mutable = snapshot as Map<string, string>;
                mutable.set('traceId', 'changed');
                mutable.delete('tenantId');
                mutable.clear();

                expect(LoggerContext.get('traceId')).toBe('snapshot');
                expect(LoggerContext.get('tenantId')).toBe('t-1');
            });
        });
    });
});
