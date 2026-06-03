import 'reflect-metadata';
import { DistributedLock } from '../src/decorators/distributed-lock';
import { LockProviderRegistry } from '../src/core/lock-provider-registry';
import { LockAcquisitionError } from '../src/errors/lock-acquisition-error';

const mockProvider = {
    acquire: jest.fn(),
    release: jest.fn(),
    renew: jest.fn(),
} as unknown as {
    acquire: jest.Mock;
    release: jest.Mock;
    renew: jest.Mock;
};

describe('@DistributedLock', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        LockProviderRegistry.clear();
        LockProviderRegistry.register('mock', mockProvider);
        LockProviderRegistry.setDefault('mock');
    });

    it('should acquire and release lock around method execution', async () => {
        mockProvider.acquire.mockResolvedValue('token-123');
        mockProvider.release.mockResolvedValue(true);

        class TestService {
            @DistributedLock({})
            async doSomething(): Promise<string> {
                return 'result';
            }
        }

        const service = new TestService();
        const result = await service.doSomething();

        expect(result).toBe('result');
        expect(mockProvider.acquire).toHaveBeenCalledWith('TestService.doSomething', 30000);
        expect(mockProvider.release).toHaveBeenCalledWith('TestService.doSomething', 'token-123');
    });

    it('should use custom key when provided', async () => {
        mockProvider.acquire.mockResolvedValue('token-123');
        mockProvider.release.mockResolvedValue(true);

        class TestService {
            @DistributedLock({ key: 'custom-lock-key' })
            async doSomething(): Promise<string> {
                return 'result';
            }
        }

        const service = new TestService();
        await service.doSomething();

        expect(mockProvider.acquire).toHaveBeenCalledWith('custom-lock-key', 30000);
    });

    it('should use function key when provided', async () => {
        mockProvider.acquire.mockResolvedValue('token-123');
        mockProvider.release.mockResolvedValue(true);

        class TestService {
            @DistributedLock({ key: (arg1: unknown) => `lock:${arg1}` })
            async doSomething(arg1: string): Promise<string> {
                return `result: ${arg1}`;
            }
        }

        const service = new TestService();
        await service.doSomething('order-123');

        expect(mockProvider.acquire).toHaveBeenCalledWith('lock:order-123', 30000);
    });

    it('should throw LockAcquisitionError when lock cannot be acquired', async () => {
        mockProvider.acquire.mockResolvedValue(null);

        class TestService {
            @DistributedLock({ retryCount: 0 })
            async doSomething(): Promise<string> {
                return 'result';
            }
        }

        const service = new TestService();

        await expect(service.doSomething()).rejects.toThrow(LockAcquisitionError);
        await expect(service.doSomething()).rejects.toThrow('Failed to acquire lock after 0 retries');
    });

    it('should throw LockAcquisitionError after retries exhausted', async () => {
        mockProvider.acquire.mockResolvedValue(null);

        class TestService {
            @DistributedLock({ retryCount: 2, retryDelay: 10 })
            async doSomething(): Promise<string> {
                return 'result';
            }
        }

        const service = new TestService();

        await expect(service.doSomething()).rejects.toThrow(LockAcquisitionError);
        expect(mockProvider.acquire).toHaveBeenCalledTimes(3);
    });

    it('should release lock even when method throws', async () => {
        mockProvider.acquire.mockResolvedValue('token-123');
        mockProvider.release.mockResolvedValue(true);

        class TestService {
            @DistributedLock({})
            async doSomething(): Promise<string> {
                throw new Error('business error');
            }
        }

        const service = new TestService();

        await expect(service.doSomething()).rejects.toThrow('business error');
        expect(mockProvider.release).toHaveBeenCalled();
    });

    it('should throw TypeError for non-async methods', () => {
        expect(() => {
            class TestService {
                @DistributedLock({})
                doSomething(): string {
                    return 'result';
                }
            }
            new TestService();
        }).toThrow(TypeError);
    });
});
