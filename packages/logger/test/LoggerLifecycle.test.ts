import { existsSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import { ConfigLoader } from '../src/core/ConfigLoader';
import { LoggerFactory } from '../src/core/LoggerFactory';
import type { LoggerInterface } from '../src/types';

const TEST_CONFIG_PATH = path.join(__dirname, 'test-logger-lifecycle-config.yaml');
const SIGNAL_A = 'logger-lifecycle-signal-a';
const SIGNAL_B = 'logger-lifecycle-signal-b';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
    reject(reason?: unknown): void;
}

interface FactoryInternals {
    container: { close(): unknown } | null;
    shutdownPromise: Promise<void> | null;
    wrapperCache: Map<string, LoggerInterface>;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function internals(): FactoryInternals {
    return LoggerFactory as unknown as FactoryInternals;
}

function emitProcessEvent(event: string): boolean {
    return (process as unknown as { emit(name: string): boolean }).emit(event);
}

function processListeners(event: string): Function[] {
    return (process as unknown as { listeners(name: string): Function[] }).listeners(event);
}

function setContainer(close: () => unknown): jest.Mock {
    const closeMock = jest.fn(close);
    internals().container = { close: closeMock };
    return closeMock;
}

function writeNoopConfig(level: 'debug' | 'info' = 'info'): void {
    writeFileSync(
        TEST_CONFIG_PATH,
        `root:\n  level: ${level}\n  console:\n    enabled: false\n  file:\n    enabled: false\n`
    );
    process.env.LOGGER_CONFIG_PATH = TEST_CONFIG_PATH;
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('LoggerFactory lifecycle', () => {
    const originalConfigPath = process.env.LOGGER_CONFIG_PATH;

    beforeEach(() => {
        LoggerFactory.reset();
        jest.useRealTimers();
        jest.restoreAllMocks();
        delete process.env.LOGGER_CONFIG_PATH;
    });

    afterEach(() => {
        jest.useRealTimers();
        LoggerFactory.reset();
        jest.restoreAllMocks();
        process.removeAllListeners(SIGNAL_A);
        process.removeAllListeners(SIGNAL_B);
        if (originalConfigPath === undefined) delete process.env.LOGGER_CONFIG_PATH;
        else process.env.LOGGER_CONFIG_PATH = originalConfigPath;
        if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH);
    });

    describe('shared shutdown round', () => {
        it('makes concurrent callers wait for one container close', async () => {
            const close = deferred<void>();
            const closeMock = setContainer(() => close.promise);
            const firstDone = jest.fn();
            const secondDone = jest.fn();

            const first = LoggerFactory.shutdown({ timeout: 1000 }).then(firstDone);
            const second = LoggerFactory.shutdown({ timeout: 10 }).then(secondDone);

            await flushMicrotasks();
            expect(closeMock).toHaveBeenCalledTimes(1);
            expect(firstDone).not.toHaveBeenCalled();
            expect(secondDone).not.toHaveBeenCalled();

            close.resolve();
            await Promise.all([first, second]);
            expect(firstDone).toHaveBeenCalledTimes(1);
            expect(secondDone).toHaveBeenCalledTimes(1);
        });

        it('uses only the first caller options', async () => {
            jest.useFakeTimers();
            const close = deferred<void>();
            setContainer(() => close.promise);
            const firstCallback = jest.fn();
            const secondCallback = jest.fn();

            const first = LoggerFactory.shutdown({ timeout: 100, onShutdown: firstCallback });
            const second = LoggerFactory.shutdown({ timeout: 1, onShutdown: secondCallback });
            await jest.advanceTimersByTimeAsync(1);
            expect(internals().shutdownPromise).not.toBeNull();

            await jest.advanceTimersByTimeAsync(99);
            await Promise.all([first, second]);
            expect(firstCallback).toHaveBeenCalledTimes(1);
            expect(secondCallback).not.toHaveBeenCalled();
        });

        it('safely handles shutdown when already idle', async () => {
            await expect(LoggerFactory.shutdown({ timeout: 0 })).resolves.toBeUndefined();
            await expect(LoggerFactory.shutdown({ timeout: 0 })).resolves.toBeUndefined();
        });
    });

    describe('access guard', () => {
        it('rejects init and existing/new logger access while shutting down', async () => {
            const close = deferred<void>();
            setContainer(() => close.promise);
            const cached: LoggerInterface = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };
            internals().wrapperCache.set('existing', cached);
            const loadSpy = jest.spyOn(ConfigLoader, 'load');
            const shutdown = LoggerFactory.shutdown({ timeout: 1000 });

            expect(() => LoggerFactory.getLogger('existing')).toThrow('LoggerFactory is shutting down');
            expect(() => LoggerFactory.getLogger('new')).toThrow('LoggerFactory is shutting down');
            expect(() => LoggerFactory.init()).toThrow('LoggerFactory is shutting down');
            expect(loadSpy).not.toHaveBeenCalled();
            expect(internals().wrapperCache.get('existing')).toBe(cached);

            close.resolve();
            await shutdown;
        });
    });

    describe('timeout and failure cleanup', () => {
        it('cancels the timeout when close finishes first', async () => {
            jest.useFakeTimers();
            setContainer(() => Promise.resolve());

            await LoggerFactory.shutdown({ timeout: 5000 });

            expect(jest.getTimerCount()).toBe(0);
        });

        it('finishes on timeout and observes a late close rejection', async () => {
            jest.useFakeTimers();
            const close = deferred<void>();
            setContainer(() => close.promise);
            const unhandled: unknown[] = [];
            const onUnhandled = (reason: unknown): void => {
                unhandled.push(reason);
            };
            process.on('unhandledRejection', onUnhandled);

            try {
                const shutdown = LoggerFactory.shutdown({ timeout: 25 });
                await jest.advanceTimersByTimeAsync(25);
                await expect(shutdown).resolves.toBeUndefined();
                expect(internals().shutdownPromise).toBeNull();

                close.reject(new Error('late close failure'));
                await flushMicrotasks();
                expect(unhandled).toEqual([]);
            } finally {
                process.off('unhandledRejection', onUnhandled);
            }
        });

        it.each(['sync', 'async'] as const)('propagates a %s close error to every caller', async (mode) => {
            const error = new Error(`${mode} close failure`);
            const closeMock = setContainer(() => {
                if (mode === 'sync') throw error;
                return Promise.reject(error);
            });

            const first = LoggerFactory.shutdown({ timeout: 1000 });
            const second = LoggerFactory.shutdown({ timeout: 1 });

            await expect(first).rejects.toBe(error);
            await expect(second).rejects.toBe(error);
            expect(closeMock).toHaveBeenCalledTimes(1);
            expect(internals().shutdownPromise).toBeNull();
        });

        it('cleans state before running the callback', async () => {
            writeNoopConfig();
            LoggerFactory.getLogger('app');
            const callback = jest.fn(() => {
                expect(internals().container).toBeNull();
                expect(internals().wrapperCache.size).toBe(0);
                expect(ConfigLoader.getConfig()).toBeNull();
            });

            await LoggerFactory.shutdown({ timeout: 1000, onShutdown: callback });

            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('shares a callback error and remains reusable', async () => {
            const callbackError = new Error('callback failure');
            const firstCallback = jest.fn(() => {
                throw callbackError;
            });
            const secondCallback = jest.fn();
            setContainer(() => Promise.resolve());

            const first = LoggerFactory.shutdown({ onShutdown: firstCallback });
            const second = LoggerFactory.shutdown({ onShutdown: secondCallback });
            await expect(first).rejects.toBe(callbackError);
            await expect(second).rejects.toBe(callbackError);
            expect(firstCallback).toHaveBeenCalledTimes(1);
            expect(secondCallback).not.toHaveBeenCalled();

            expect(() => LoggerFactory.init()).not.toThrow();
        });

        it('preserves the close error when close and callback both fail', async () => {
            const closeError = new Error('close failure');
            const callbackError = new Error('callback failure');
            setContainer(() => Promise.reject(closeError));

            await expect(
                LoggerFactory.shutdown({
                    onShutdown: () => {
                        throw callbackError;
                    },
                })
            ).rejects.toBe(closeError);
            expect((closeError as Error & { shutdownCallbackError?: unknown }).shutdownCallbackError).toBe(
                callbackError
            );
        });
    });

    describe('clean rebuild', () => {
        it('returns a new wrapper for the same name after shutdown', async () => {
            writeNoopConfig();
            const first = LoggerFactory.getLogger('app');
            await LoggerFactory.shutdown({ timeout: 1000 });

            const second = LoggerFactory.getLogger('app');
            expect(second).not.toBe(first);
        });

        it('reloads changed configuration after shutdown', async () => {
            writeNoopConfig('info');
            LoggerFactory.init();
            expect(ConfigLoader.getConfig()?.level).toBe('info');
            await LoggerFactory.shutdown({ timeout: 1000 });

            writeNoopConfig('debug');
            LoggerFactory.init();
            expect(ConfigLoader.getConfig()?.level).toBe('debug');
        });

        it.each(['success', 'timeout', 'close-error', 'callback-error'] as const)(
            'can reinitialize after %s termination',
            async (mode) => {
                jest.useFakeTimers();
                const close = deferred<void>();
                const closeError = new Error('close failure');
                const callbackError = new Error('callback failure');

                if (mode === 'success') setContainer(() => Promise.resolve());
                if (mode === 'timeout') setContainer(() => close.promise);
                if (mode === 'close-error') setContainer(() => Promise.reject(closeError));
                if (mode === 'callback-error') setContainer(() => Promise.resolve());

                const shutdown = LoggerFactory.shutdown({
                    timeout: 10,
                    ...(mode === 'callback-error'
                        ? {
                              onShutdown: () => {
                                  throw callbackError;
                              },
                          }
                        : {}),
                });

                if (mode === 'timeout') await jest.advanceTimersByTimeAsync(10);
                if (mode === 'close-error') await expect(shutdown).rejects.toBe(closeError);
                else if (mode === 'callback-error') await expect(shutdown).rejects.toBe(callbackError);
                else await expect(shutdown).resolves.toBeUndefined();

                expect(() => LoggerFactory.init()).not.toThrow();
                if (mode === 'timeout') close.resolve();
            }
        );

        it('invalidates a cached no-op logger and keeps idle shutdown idempotent', async () => {
            writeNoopConfig();
            const first = LoggerFactory.getLogger('silent');
            await LoggerFactory.shutdown({ timeout: 1000 });
            await expect(LoggerFactory.shutdown({ timeout: 0 })).resolves.toBeUndefined();

            const second = LoggerFactory.getLogger('silent');
            expect(second).not.toBe(first);
        });
    });

    describe('shutdown signal handlers', () => {
        it('deduplicates default and partially overlapping signal registrations', () => {
            const termBefore = process.listenerCount('SIGTERM');
            const intBefore = process.listenerCount('SIGINT');

            LoggerFactory.setupShutdownHandlers();
            LoggerFactory.setupShutdownHandlers({ signals: ['SIGTERM'] });
            LoggerFactory.setupShutdownHandlers({ signals: ['SIGTERM', 'SIGINT'] });

            expect(process.listenerCount('SIGTERM')).toBe(termBefore + 1);
            expect(process.listenerCount('SIGINT')).toBe(intBefore + 1);
        });

        it('adds only new custom signals and keeps first options', async () => {
            jest.useFakeTimers();
            const firstCallback = jest.fn();
            const secondCallback = jest.fn();
            LoggerFactory.setupShutdownHandlers({
                signals: [SIGNAL_A],
                timeout: 20,
                onShutdown: firstCallback,
            });
            LoggerFactory.setupShutdownHandlers({
                signals: [SIGNAL_A, SIGNAL_B],
                timeout: 1,
                onShutdown: secondCallback,
            });
            setContainer(() => new Promise<void>(() => undefined));
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

            expect(process.listenerCount(SIGNAL_A)).toBe(1);
            expect(process.listenerCount(SIGNAL_B)).toBe(1);
            emitProcessEvent(SIGNAL_A);
            await jest.advanceTimersByTimeAsync(1);
            expect(exitSpy).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(19);
            await flushMicrotasks();

            expect(firstCallback).toHaveBeenCalledTimes(1);
            expect(secondCallback).not.toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledTimes(1);
            expect(exitSpy).toHaveBeenCalledWith(0);
        });

        it('removes every factory handler and exits once when a signal fires', async () => {
            const close = deferred<void>();
            setContainer(() => close.promise);
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
            LoggerFactory.setupShutdownHandlers({ signals: [SIGNAL_A, SIGNAL_B], timeout: 1000 });

            emitProcessEvent(SIGNAL_A);
            emitProcessEvent(SIGNAL_B);
            expect(process.listenerCount(SIGNAL_A)).toBe(0);
            expect(process.listenerCount(SIGNAL_B)).toBe(0);
            expect(exitSpy).not.toHaveBeenCalled();

            close.resolve();
            await internals().shutdownPromise;
            await flushMicrotasks();
            expect(exitSpy).toHaveBeenCalledTimes(1);
            expect(exitSpy).toHaveBeenCalledWith(0);
        });

        it('reset removes only factory-owned listeners', () => {
            const external = jest.fn();
            process.on(SIGNAL_A, external);
            LoggerFactory.setupShutdownHandlers({ signals: [SIGNAL_A, SIGNAL_B] });

            LoggerFactory.reset();

            expect(processListeners(SIGNAL_A)).toContain(external);
            expect(process.listenerCount(SIGNAL_A)).toBe(1);
            expect(process.listenerCount(SIGNAL_B)).toBe(0);
            process.off(SIGNAL_A, external);
        });
    });
});
