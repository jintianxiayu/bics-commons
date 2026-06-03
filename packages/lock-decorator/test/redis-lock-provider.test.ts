import { RedisLockProvider } from '../src/core/redis-lock-provider';

const mockRedisClient = {
    set: jest.fn(),
    eval: jest.fn(),
};

describe('RedisLockProvider', () => {
    let provider: RedisLockProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        provider = new RedisLockProvider(mockRedisClient as any);
    });

    describe('acquire', () => {
        it('should return token when lock acquired successfully', async () => {
            mockRedisClient.set.mockResolvedValue('OK');

            const token = await provider.acquire('order:12345', 30000);

            expect(token).toBeTruthy();
            expect(typeof token).toBe('string');
            expect(mockRedisClient.set).toHaveBeenCalledWith('order:12345', expect.any(String), 'PX', 30000, 'NX');
        });

        it('should return null when lock is already held', async () => {
            mockRedisClient.set.mockResolvedValue(null);

            const token = await provider.acquire('order:12345', 30000);

            expect(token).toBeNull();
        });
    });

    describe('release', () => {
        it('should return true when release succeeds', async () => {
            mockRedisClient.eval.mockResolvedValue(1);

            const result = await provider.release('order:12345', 'correct-token');

            expect(result).toBe(true);
            expect(mockRedisClient.eval).toHaveBeenCalled();
        });

        it('should return false when token does not match', async () => {
            mockRedisClient.eval.mockResolvedValue(0);

            const result = await provider.release('order:12345', 'wrong-token');

            expect(result).toBe(false);
        });
    });

    describe('renew', () => {
        it('should return true when renew succeeds', async () => {
            mockRedisClient.eval.mockResolvedValue(1);

            const result = await provider.renew('order:12345', 'correct-token', 30000);

            expect(result).toBe(true);
            expect(mockRedisClient.eval).toHaveBeenCalled();
        });

        it('should return false when token does not match', async () => {
            mockRedisClient.eval.mockResolvedValue(0);

            const result = await provider.renew('order:12345', 'wrong-token', 30000);

            expect(result).toBe(false);
        });
    });
});
