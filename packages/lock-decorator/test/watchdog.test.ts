jest.mock('@jintianxiayu/logger', () => ({
    LoggerFactory: { getLogger: jest.fn() },
}));

import { LoggerFactory, type LoggerInterface } from '@jintianxiayu/logger';
import { Watchdog } from '../src/core/watchdog';

const mockProvider = {
    acquire: jest.fn(),
    release: jest.fn(),
    renew: jest.fn(),
} as unknown as {
    acquire: jest.Mock;
    release: jest.Mock;
    renew: jest.Mock;
};

const logger: jest.Mocked<LoggerInterface> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
const getLogger = jest.mocked(LoggerFactory.getLogger);

describe('Watchdog', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        getLogger.mockReturnValue(logger);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should start timer and renew periodically', async () => {
        mockProvider.renew.mockResolvedValue(true);
        const watchdog = new Watchdog({
            provider: mockProvider,
            key: 'key',
            token: 'token',
            ttl: 30000,
            interval: 100,
        });

        watchdog.start();

        expect(mockProvider.renew).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(100);
        expect(mockProvider.renew).toHaveBeenCalledWith('key', 'token', 30000);
        expect(logger.debug).toHaveBeenLastCalledWith('Distributed lock renewed', {
            ttlMs: 30000,
            renewIntervalMs: 100,
            event: 'lock.renewed',
        });

        await jest.advanceTimersByTimeAsync(100);
        expect(mockProvider.renew).toHaveBeenCalledTimes(2);
    });

    it('should stop renewal when renew returns false', async () => {
        mockProvider.renew.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        const watchdog = new Watchdog({
            provider: mockProvider,
            key: 'key',
            token: 'token',
            ttl: 30000,
            interval: 100,
        });

        watchdog.start();

        await jest.advanceTimersByTimeAsync(100);
        expect(mockProvider.renew).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(100);
        expect(mockProvider.renew).toHaveBeenCalledTimes(2);
        expect(mockProvider.renew).toHaveBeenCalledWith('key', 'token', 30000);
        expect(logger.warn).toHaveBeenCalledWith('Distributed lock ownership lost', {
            ttlMs: 30000,
            renewIntervalMs: 100,
            phase: 'renew',
            event: 'lock.ownership_lost',
        });

        await jest.advanceTimersByTimeAsync(100);
        expect(mockProvider.renew).toHaveBeenCalledTimes(2);
    });

    it('should stop renewal when explicitly stopped', async () => {
        mockProvider.renew.mockResolvedValue(true);
        const watchdog = new Watchdog({
            provider: mockProvider,
            key: 'key',
            token: 'token',
            ttl: 30000,
            interval: 100,
        });

        watchdog.start();
        await jest.advanceTimersByTimeAsync(100);
        expect(mockProvider.renew).toHaveBeenCalledTimes(1);

        watchdog.stop();
        await jest.advanceTimersByTimeAsync(100);
        expect(mockProvider.renew).toHaveBeenCalledTimes(1);
    });

    it('lock-operation-logging/W01 renew rejection 被记录并停止后续续期', async () => {
        const renewError = new Error('redis unavailable');
        mockProvider.renew.mockRejectedValue(renewError);
        const watchdog = new Watchdog({
            provider: mockProvider,
            key: 'sensitive-key',
            token: 'sensitive-token',
            ttl: 30000,
            interval: 100,
        });

        watchdog.start();
        await jest.advanceTimersByTimeAsync(100);

        expect(logger.error).toHaveBeenCalledWith('Distributed lock operation failed', {
            ttlMs: 30000,
            renewIntervalMs: 100,
            operation: 'renew',
            error: renewError,
            event: 'lock.operation_failed',
        });
        await jest.advanceTimersByTimeAsync(200);
        expect(mockProvider.renew).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('lock-operation-logging/W02 Logger 失败不阻止 ownership lost 后停止', async () => {
        logger.warn.mockImplementation(() => {
            throw new Error('logger closed');
        });
        mockProvider.renew.mockResolvedValue(false);
        const watchdog = new Watchdog({
            provider: mockProvider,
            key: 'key',
            token: 'token',
            ttl: 30000,
            interval: 100,
        });

        watchdog.start();
        await jest.advanceTimersByTimeAsync(300);

        expect(mockProvider.renew).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('范围外的慢续期仍允许重叠调用', async () => {
        let completeRenewal: ((value: boolean) => void) | undefined;
        mockProvider.renew.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    completeRenewal = resolve;
                })
        );
        const watchdog = new Watchdog({
            provider: mockProvider,
            key: 'key',
            token: 'token',
            ttl: 30000,
            interval: 100,
        });

        watchdog.start();
        await jest.advanceTimersByTimeAsync(200);

        expect(mockProvider.renew).toHaveBeenCalledTimes(2);
        watchdog.stop();
        completeRenewal?.(true);
        await Promise.resolve();
    });

    it('范围外的重复 start 仍会创建多个定时器', () => {
        const watchdog = new Watchdog({
            provider: mockProvider,
            key: 'key',
            token: 'token',
            ttl: 30000,
            interval: 100,
        });

        watchdog.start();
        watchdog.start();

        expect(jest.getTimerCount()).toBe(2);
        watchdog.stop();
        expect(jest.getTimerCount()).toBe(1);
        jest.clearAllTimers();
    });
});
