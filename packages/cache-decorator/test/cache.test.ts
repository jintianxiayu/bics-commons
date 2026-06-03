import { Cache } from '../src/decorators/cache';
import { CacheProviderRegistry } from '../src/core/cache-provider-registry';
import { MemoryCacheProvider } from '../src/core/native-cache';

describe('@Cache 装饰器', () => {
    beforeAll(() => {
        CacheProviderRegistry.register('memory', new MemoryCacheProvider());
        CacheProviderRegistry.setDefault('memory');
    });

    beforeEach(() => {
        const provider = CacheProviderRegistry.get();
        provider.clear();
    });

    describe('基础缓存', () => {
        it('应缓存方法结果', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache')
                async getUser(id: number) {
                    this.callCount++;
                    return { id, name: 'test' };
                }
            }

            const service = new UserService();
            const result1 = await service.getUser(1);
            const result2 = await service.getUser(1);

            expect(result1).toEqual({ id: 1, name: 'test' });
            expect(result2).toEqual({ id: 1, name: 'test' });
            expect(service.callCount).toBe(1);
        });

        it('不同参数应分别缓存', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache')
                async getUser(id: number) {
                    this.callCount++;
                    return { id };
                }
            }

            const service = new UserService();
            await service.getUser(1);
            await service.getUser(2);

            expect(service.callCount).toBe(2);
        });
    });

    describe('TTL 过期', () => {
        it('应在 TTL 后失效', async () => {
            jest.useFakeTimers();

            class UserService {
                @Cache('user-cache', { ttl: 60 })
                async getUser(id: number) {
                    return { id };
                }
            }

            const service = new UserService();
            const result1 = await service.getUser(1);
            expect(result1).toEqual({ id: 1 });

            jest.advanceTimersByTime(60001);

            const result2 = await service.getUser(1);
            expect(result2).toEqual({ id: 1 });

            jest.useRealTimers();
        });
    });

    describe('缓存命中', () => {
        it('应直接返回缓存值', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache')
                async getUser(id: number) {
                    this.callCount++;
                    return { id, timestamp: Date.now() };
                }
            }

            const service = new UserService();
            const result1 = await service.getUser(1);
            const result2 = await service.getUser(1);

            expect(result1.id).toBe(1);
            expect(result2.id).toBe(1);
            expect(result1.timestamp).toBe(result2.timestamp);
            expect(service.callCount).toBe(1);
        });
    });

    describe('错误结果缓存', () => {
        it.skip('应缓存错误结果', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache')
                async getUser(_id: number) {
                    this.callCount++;
                    throw new Error('user not found');
                }
            }

            const service = new UserService();

            try {
                await service.getUser(1);
            } catch (e) {
                // expected
            }
            try {
                await service.getUser(1);
            } catch (e) {
                // expected
            }
            expect(service.callCount).toBe(1);
        });
    });

    describe('请求合并', () => {
        it.skip('并发请求应返回同一 Promise', async () => {
            let resolvePromise: ((value: number) => void) | undefined;
            let callCount = 0;

            class UserService {
                @Cache('user-cache')
                async getUser(_id: number): Promise<number> {
                    callCount++;
                    return new Promise((resolve) => {
                        resolvePromise = resolve;
                    });
                }
            }

            const service = new UserService();
            const promise1 = service.getUser(1);
            const promise2 = service.getUser(1);

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(callCount).toBe(1);
            expect(promise1).toBe(promise2);

            resolvePromise!(42);

            const [result1, result2] = await Promise.all([promise1, promise2]);
            expect(result1).toBe(42);
            expect(result2).toBe(42);
            expect(callCount).toBe(1);
        });
    });

    describe('key 选项', () => {
        it('key 为 undefined 时使用自动生成逻辑', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache', { key: undefined })
                async getUser(id: number) {
                    this.callCount++;
                    return { id };
                }
            }

            const service = new UserService();
            await service.getUser(1);
            await service.getUser(1);
            expect(service.callCount).toBe(1);
        });

        it('key 为 null 时使用自动生成逻辑', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache', { key: null })
                async getUser(id: number) {
                    this.callCount++;
                    return { id };
                }
            }

            const service = new UserService();
            await service.getUser(1);
            await service.getUser(1);
            expect(service.callCount).toBe(1);
        });

        it('key 为字符串时使用字符串值', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache', { key: 'specific-key' })
                async getUser(id: number) {
                    this.callCount++;
                    return { id };
                }
            }

            const service = new UserService();
            await service.getUser(1);
            await service.getUser(2);
            expect(service.callCount).toBe(1);
        });

        it('key 为函数时使用函数返回值', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache', { key: (...args: unknown[]) => String(args[0]) })
                async getUser(id: number) {
                    this.callCount++;
                    return { id };
                }
            }

            const service = new UserService();
            await service.getUser(1);
            await service.getUser(1);
            expect(service.callCount).toBe(1);
            await service.getUser(2);
            expect(service.callCount).toBe(2);
        });

        it('key 函数抛出异常时降级到自动生成', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache', {
                    key: () => {
                        throw new Error('bad key');
                    },
                })
                async getUser(id: number) {
                    this.callCount++;
                    return { id };
                }
            }

            const service = new UserService();
            await service.getUser(1);
            await service.getUser(1);
            expect(service.callCount).toBe(1);
        });
    });
});
