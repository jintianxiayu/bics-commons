import type { CacheProvider } from '../src/core/cache-provider';
import { CacheProviderRegistry } from '../src/core/cache-provider-registry';
import { KeyBuilder } from '../src/core/key-builder';
import { MemoryCacheProvider } from '../src/core/native-cache';
import { Cache, type CacheErrorCodec, type CacheErrorPolicy, type CacheOptions } from '../src/decorators/cache';

interface ProviderHarness {
    readonly provider: CacheProvider;
    readonly get: jest.Mock<unknown, [string]>;
    readonly set: jest.Mock<void, [string, unknown, number?]>;
    readonly values: Map<string, unknown>;
}

interface RejectionDeferred {
    readonly promise: Promise<never>;
    readonly reject: (reason: unknown) => void;
}

/** 创建同步读写且记录调用参数的可插拔 Provider。 */
function createProvider(): ProviderHarness {
    const values = new Map<string, unknown>();
    const get = jest.fn<unknown, [string]>((key) => values.get(key));
    const set = jest.fn<void, [string, unknown, number?]>((key, value) => {
        values.set(key, value);
    });
    const provider: CacheProvider = {
        get: <Value>(key: string): Value | undefined => get(key) as Value | undefined,
        set: <Value>(key: string, value: Value, ttl?: number): void => set(key, value, ttl),
        delete: (key: string): void => {
            values.delete(key);
        },
        clear: (): void => {
            values.clear();
        },
        deleteByPattern: (): void => {
            values.clear();
        },
    };
    return { provider, get, set, values };
}

/** 创建由测试显式拒绝的 Promise，用于观察 pending 身份与清理。 */
function createRejectionDeferred(): RejectionDeferred {
    let rejectPromise: ((reason: unknown) => void) | undefined;
    const promise = new Promise<never>((_resolve, reject) => {
        rejectPromise = reject;
    });
    if (!rejectPromise) {
        throw new Error('Deferred rejecter was not initialized');
    }
    return { promise, reject: rejectPromise };
}

/** 等待并返回 Promise 的 rejection 值，包括 undefined 等非 Error 值。 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('Expected promise to reject');
}

/** 使用公开协议形状构造当前版本异常条目，避免测试依赖内部 helper。 */
function currentErrorEntry(payload: unknown): unknown {
    return {
        error: {
            kind: '@jintianxiayu/cache-decorator/error',
            version: 1,
            payload,
        },
    };
}

beforeEach(() => {
    CacheProviderRegistry.clear();
    CacheProviderRegistry.register('memory', new MemoryCacheProvider());
    CacheProviderRegistry.setDefault('memory');
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    CacheProviderRegistry.clear();
});

describe('@Cache 装饰器', () => {
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
                callCount = 0;

                @Cache('user-cache', { ttl: 60 })
                async getUser(id: number) {
                    this.callCount++;
                    return { id };
                }
            }

            const service = new UserService();
            const result1 = await service.getUser(1);
            expect(result1).toEqual({ id: 1 });

            jest.advanceTimersByTime(60001);

            const result2 = await service.getUser(1);
            expect(result2).toEqual({ id: 1 });
            expect(service.callCount).toBe(2);
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
        it('省略策略时不持久化业务异常并允许顺序重试', async () => {
            class UserService {
                callCount = 0;

                @Cache('user-cache')
                async getUser(_id: number) {
                    this.callCount++;
                    throw new Error(`user not found ${this.callCount}`);
                }
            }

            const service = new UserService();

            await expect(service.getUser(1)).rejects.toThrow('user not found 1');
            await expect(service.getUser(1)).rejects.toThrow('user not found 2');
            expect(service.callCount).toBe(2);
        });
    });

    describe('请求合并', () => {
        it('并发请求应返回同一 Promise', async () => {
            let resolvePromise: ((value: number) => void) | undefined;
            let callCount = 0;
            const resultPromise = new Promise<number>((resolve) => {
                resolvePromise = resolve;
            });

            class UserService {
                @Cache('user-cache')
                async getUser(_id: number): Promise<number> {
                    callCount++;
                    return resultPromise;
                }
            }

            const service = new UserService();
            const promise1 = service.getUser(1);
            const promise2 = service.getUser(1);

            await Promise.resolve();
            resolvePromise!(42);

            const [result1, result2] = await Promise.all([promise1, promise2]);
            expect(callCount).toBe(1);
            expect(promise1).toBe(promise2);
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

describe('异常策略配置边界', () => {
    it('非法异常 TTL 在 decorator 求值时抛出 RangeError 且不访问 Provider 或业务方法', () => {
        const providerGet = jest.spyOn(CacheProviderRegistry, 'get');
        const businessMethod = jest.fn();
        const invalidTtls = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

        for (const ttl of invalidTtls) {
            expect(() => Cache('invalid-error-ttl', { errorCache: { ttl } })).toThrow(RangeError);
        }

        expect(providerGet).not.toHaveBeenCalled();
        expect(businessMethod).not.toHaveBeenCalled();
    });

    it('运行期畸形筛选器和 codec 在 decorator 求值时抛出 TypeError', () => {
        const invalidPolicies: readonly unknown[] = [
            null,
            { ttl: 5, shouldCache: 'yes' },
            { ttl: 5, codec: null },
            { ttl: 5, codec: { encode: (): unknown => ({}) } },
            { ttl: 5, codec: { decode: (): unknown => new Error('decoded') } },
        ];

        for (const policy of invalidPolicies) {
            expect(() => Cache('invalid-error-policy', { errorCache: policy as CacheErrorPolicy })).toThrow(TypeError);
        }
    });
});

describe('异常策略编排', () => {
    it('Provider 读取失败不调用异常筛选器、codec 或业务方法', async () => {
        const provider = createProvider();
        const readError = new Error('redis unavailable');
        provider.get.mockImplementation(() => {
            throw readError;
        });
        CacheProviderRegistry.register('failed-read', provider.provider);
        const shouldCache = jest.fn(() => true);
        const encode = jest.fn((error: unknown): unknown => error);
        const decode = jest.fn((payload: unknown): unknown => payload);
        const businessMethod = jest.fn();

        class UserService {
            @Cache('failed-read-users', {
                providerName: 'failed-read',
                errorCache: { ttl: 5, shouldCache, codec: { encode, decode } },
            })
            getUser(): unknown {
                return businessMethod();
            }
        }

        await expect(new UserService().getUser()).rejects.toBe(readError);
        expect(businessMethod).not.toHaveBeenCalled();
        expect(shouldCache).not.toHaveBeenCalled();
        expect(encode).not.toHaveBeenCalled();
        expect(decode).not.toHaveBeenCalled();
        expect(provider.set).not.toHaveBeenCalled();
    });

    it('key resolver 失败后的业务成功只写入正常结果', async () => {
        const provider = createProvider();
        CacheProviderRegistry.register('key-fallback', provider.provider);
        const shouldCache = jest.fn(() => true);
        const codec: CacheErrorCodec = {
            encode: jest.fn((error: unknown): unknown => error),
            decode: jest.fn((payload: unknown): unknown => payload),
        };

        class UserService {
            @Cache('key-fallback-users', {
                providerName: 'key-fallback',
                key: () => {
                    throw new Error('resolver failed');
                },
                errorCache: { ttl: 5, shouldCache, codec },
            })
            async getUser(id: number): Promise<{ id: number }> {
                return { id };
            }
        }

        await expect(new UserService().getUser(7)).resolves.toEqual({ id: 7 });
        expect(shouldCache).not.toHaveBeenCalled();
        expect(codec.encode).not.toHaveBeenCalled();
        expect(provider.set).toHaveBeenCalledWith(expect.any(String), { value: { id: 7 } }, undefined);
    });

    it('省略筛选器时接受异常，命中使用默认 codec 的新 Error', async () => {
        const businessError = new Error('stable not found');

        class UserService {
            callCount = 0;

            @Cache('default-error-policy', { errorCache: { ttl: 5 } })
            async getUser(): Promise<never> {
                this.callCount += 1;
                throw businessError;
            }
        }

        const service = new UserService();
        expect(await captureRejection(service.getUser())).toBe(businessError);
        const cachedError = await captureRejection(service.getUser());
        expect(cachedError).toBeInstanceOf(Error);
        expect(cachedError).not.toBe(businessError);
        expect((cachedError as Error).message).toBe('stable not found');
        expect(service.callCount).toBe(1);
    });

    it('筛选器返回 true 时只求值和 encode 一次并使用异常 TTL', async () => {
        const provider = createProvider();
        CacheProviderRegistry.register('accepted-error', provider.provider);
        const businessError = new Error('accepted');
        const shouldCache = jest.fn((_error: unknown): boolean => true);
        const encode = jest.fn((_error: unknown): unknown => ({ code: 'ACCEPTED' }));
        const codec: CacheErrorCodec = {
            encode,
            decode: (payload: unknown): unknown => payload,
        };

        class UserService {
            @Cache('accepted-error-users', {
                providerName: 'accepted-error',
                errorCache: { ttl: 9, shouldCache, codec },
            })
            async getUser(): Promise<never> {
                throw businessError;
            }
        }

        await expect(new UserService().getUser()).rejects.toBe(businessError);
        expect(shouldCache).toHaveBeenCalledTimes(1);
        expect(shouldCache).toHaveBeenCalledWith(businessError);
        expect(encode).toHaveBeenCalledTimes(1);
        expect(provider.set).toHaveBeenCalledTimes(1);
        expect(provider.set.mock.calls[0]?.[2]).toBe(9);
    });

    it('筛选器返回 false 时跳过 codec 和写入并允许后续重试', async () => {
        const provider = createProvider();
        CacheProviderRegistry.register('rejected-error', provider.provider);
        const shouldCache = jest.fn((_error: unknown): boolean => false);
        const codec: CacheErrorCodec = {
            encode: jest.fn((error: unknown): unknown => error),
            decode: jest.fn((payload: unknown): unknown => payload),
        };
        let callCount = 0;

        class UserService {
            @Cache('rejected-error-users', {
                providerName: 'rejected-error',
                errorCache: { ttl: 9, shouldCache, codec },
            })
            async getUser(): Promise<never> {
                callCount += 1;
                throw new Error(`transient ${callCount}`);
            }
        }

        const service = new UserService();
        await expect(service.getUser()).rejects.toThrow('transient 1');
        await expect(service.getUser()).rejects.toThrow('transient 2');
        expect(shouldCache).toHaveBeenCalledTimes(2);
        expect(codec.encode).not.toHaveBeenCalled();
        expect(provider.set).not.toHaveBeenCalled();
        expect(callCount).toBe(2);
    });

    it('筛选器抛错时 fail-closed 且不遮蔽原业务异常', async () => {
        const provider = createProvider();
        CacheProviderRegistry.register('failed-predicate', provider.provider);
        const businessError = new Error('original business failure');
        const shouldCache = jest.fn(() => {
            throw new Error('predicate secret');
        });
        const codec: CacheErrorCodec = {
            encode: jest.fn((error: unknown): unknown => error),
            decode: jest.fn((payload: unknown): unknown => payload),
        };

        class UserService {
            @Cache('failed-predicate-users', {
                providerName: 'failed-predicate',
                errorCache: { ttl: 9, shouldCache, codec },
            })
            async getUser(): Promise<never> {
                throw businessError;
            }
        }

        await expect(new UserService().getUser()).rejects.toBe(businessError);
        expect(shouldCache).toHaveBeenCalledTimes(1);
        expect(codec.encode).not.toHaveBeenCalled();
        expect(provider.set).not.toHaveBeenCalled();
    });

    it('正常结果和异常分别使用正常 TTL 与异常 TTL', async () => {
        const provider = createProvider();
        CacheProviderRegistry.register('separate-ttl', provider.provider);
        const businessError = new Error('negative result');

        class UserService {
            @Cache('normal-ttl-users', {
                providerName: 'separate-ttl',
                ttl: 300,
                errorCache: { ttl: 10 },
            })
            async getUser(): Promise<string> {
                return 'value';
            }

            @Cache('error-ttl-users', {
                providerName: 'separate-ttl',
                ttl: 300,
                errorCache: { ttl: 10 },
            })
            async getMissingUser(): Promise<never> {
                throw businessError;
            }

            @Cache('omitted-normal-ttl', { providerName: 'separate-ttl', errorCache: { ttl: 10 } })
            async getConfig(): Promise<string> {
                return 'config';
            }
        }

        const service = new UserService();
        await expect(service.getUser()).resolves.toBe('value');
        await expect(service.getMissingUser()).rejects.toBe(businessError);
        await expect(service.getConfig()).resolves.toBe('config');

        expect(provider.set.mock.calls.map((call) => call[2])).toEqual([300, 10, undefined]);
    });

    it('Memory Provider 中异常 TTL 到期后重新执行业务方法', async () => {
        jest.useFakeTimers({ now: 0 });

        class UserService {
            callCount = 0;

            @Cache('expiring-errors', { errorCache: { ttl: 10 } })
            async getUser(): Promise<never> {
                this.callCount += 1;
                throw new Error(`failure ${this.callCount}`);
            }
        }

        const service = new UserService();
        await expect(service.getUser()).rejects.toThrow('failure 1');
        await expect(service.getUser()).rejects.toThrow('failure 1');
        expect(service.callCount).toBe(1);

        jest.advanceTimersByTime(10_001);
        await expect(service.getUser()).rejects.toThrow('failure 2');
        expect(service.callCount).toBe(2);
    });

    it('异常写入同步失败仍传播原业务异常', async () => {
        const provider = createProvider();
        const writeError = new Error('synchronous cache write failed');
        const businessError = new Error('business failure');
        provider.set.mockImplementation(() => {
            throw writeError;
        });
        CacheProviderRegistry.register('failed-error-write', provider.provider);

        class UserService {
            @Cache('failed-error-write-users', {
                providerName: 'failed-error-write',
                errorCache: { ttl: 5 },
            })
            async getUser(): Promise<never> {
                throw businessError;
            }
        }

        await expect(new UserService().getUser()).rejects.toBe(businessError);
        expect(provider.set).toHaveBeenCalledTimes(1);
    });

    it('正常写入同步失败不进入异常缓存策略', async () => {
        const provider = createProvider();
        const writeError = new Error('normal write failed');
        const shouldCache = jest.fn((_error: unknown): boolean => true);
        provider.set.mockImplementation(() => {
            throw writeError;
        });
        CacheProviderRegistry.register('failed-normal-write', provider.provider);

        class UserService {
            @Cache('failed-normal-write-users', {
                providerName: 'failed-normal-write',
                errorCache: { ttl: 5, shouldCache },
            })
            async getUser(): Promise<string> {
                return 'value';
            }
        }

        await expect(new UserService().getUser()).rejects.toBe(writeError);
        expect(provider.set).toHaveBeenCalledTimes(1);
        expect(shouldCache).not.toHaveBeenCalled();
    });
});

describe('异常表示与命中分类', () => {
    it('默认 codec 仅持久化标准 Error 的 name/message 并在命中时创建新 Error', async () => {
        const provider = createProvider();
        CacheProviderRegistry.register('default-codec', provider.provider);
        const businessError = new Error('user 13800138000 not found');
        businessError.name = 'NotFoundError';
        businessError.stack = 'sensitive stack';
        Object.assign(businessError, { internalCode: 'SECRET_CODE' });
        let callCount = 0;

        class UserService {
            @Cache('default-codec-users', { providerName: 'default-codec', errorCache: { ttl: 5 } })
            async getUser(): Promise<never> {
                callCount += 1;
                throw businessError;
            }
        }

        const service = new UserService();
        expect(await captureRejection(service.getUser())).toBe(businessError);
        const storedEntry = [...provider.values.values()][0];
        expect(storedEntry).toEqual(
            currentErrorEntry({ type: 'error', name: 'NotFoundError', message: 'user 13800138000 not found' })
        );
        expect(JSON.stringify(storedEntry)).not.toContain('sensitive stack');
        expect(JSON.stringify(storedEntry)).not.toContain('SECRET_CODE');

        const cachedError = await captureRejection(service.getUser());
        expect(cachedError).toBeInstanceOf(Error);
        expect(cachedError).not.toBe(businessError);
        expect((cachedError as Error).name).toBe('NotFoundError');
        expect((cachedError as Error).message).toBe('user 13800138000 not found');
        expect((cachedError as { internalCode?: string }).internalCode).toBeUndefined();
        expect(callCount).toBe(1);
    });

    it('默认 codec 让 JSON 兼容的非 Error 值按 JSON 表示往返', async () => {
        const cases: ReadonlyArray<readonly [string, unknown]> = [
            ['string', 'NOT_FOUND'],
            ['number', 404],
            ['boolean', false],
            ['null', null],
            ['object', { code: 'NOT_FOUND', details: [1, true, null] }],
        ];

        for (const [label, thrownValue] of cases) {
            const provider = createProvider();
            const providerName = `json-error-${label}`;
            CacheProviderRegistry.register(providerName, provider.provider);
            let callCount = 0;

            class UserService {
                @Cache(`json-error-${label}`, { providerName, errorCache: { ttl: 5 } })
                async getUser(): Promise<never> {
                    callCount += 1;
                    throw thrownValue;
                }
            }

            const service = new UserService();
            expect(await captureRejection(service.getUser())).toBe(thrownValue);
            expect(await captureRejection(service.getUser())).toEqual(thrownValue);
            expect(callCount).toBe(1);
        }
    });

    it('默认 codec 对不可 JSON 往返的值跳过写入并保留原异常', async () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        const invalidValues: ReadonlyArray<readonly [string, unknown]> = [
            ['undefined', undefined],
            ['function', (): void => undefined],
            ['symbol', Symbol('secret')],
            ['cyclic', cyclic],
            ['non-finite', Number.NaN],
            ['bigint', BigInt(1)],
        ];

        for (const [label, thrownValue] of invalidValues) {
            const provider = createProvider();
            const providerName = `invalid-error-${label}`;
            CacheProviderRegistry.register(providerName, provider.provider);
            let callCount = 0;

            class UserService {
                @Cache(`invalid-error-${label}`, { providerName, key: 'fixed', errorCache: { ttl: 5 } })
                async getUser(): Promise<never> {
                    callCount += 1;
                    throw thrownValue;
                }
            }

            const service = new UserService();
            expect(await captureRejection(service.getUser())).toBe(thrownValue);
            expect(await captureRejection(service.getUser())).toBe(thrownValue);
            expect(provider.set).not.toHaveBeenCalled();
            expect(callCount).toBe(2);
        }
    });

    it('自定义 codec 在 Memory 与自定义 Provider 中得到同一规范化 payload', async () => {
        class DomainError extends Error {
            constructor(readonly code: string) {
                super(`domain:${code}`);
                this.name = 'DomainError';
            }
        }

        const encodedPayload = { code: 'NOT_FOUND' };
        const encode = jest.fn((_error: unknown): unknown => encodedPayload);
        const decode = jest.fn((payload: unknown): unknown => {
            if (typeof payload !== 'object' || payload === null || !('code' in payload)) {
                throw new TypeError('invalid domain payload');
            }
            return new DomainError(String(payload.code));
        });
        const codec: CacheErrorCodec = { encode, decode };
        const customProvider = createProvider();
        CacheProviderRegistry.register('custom-codec-provider', customProvider.provider);
        let memoryCalls = 0;
        let customCalls = 0;

        class UserService {
            @Cache('custom-codec-memory', { providerName: 'memory', errorCache: { ttl: 5, codec } })
            async getFromMemory(): Promise<never> {
                memoryCalls += 1;
                throw new DomainError('NOT_FOUND');
            }

            @Cache('custom-codec-provider', {
                providerName: 'custom-codec-provider',
                errorCache: { ttl: 5, codec },
            })
            async getFromCustomProvider(): Promise<never> {
                customCalls += 1;
                throw new DomainError('NOT_FOUND');
            }
        }

        const service = new UserService();
        await captureRejection(service.getFromMemory());
        await captureRejection(service.getFromCustomProvider());
        const memoryEntry = await CacheProviderRegistry.get('memory').get(KeyBuilder.build('custom-codec-memory', []));
        const customEntry = [...customProvider.values.values()][0];
        expect(memoryEntry).toEqual(customEntry);
        expect((memoryEntry as { error: { payload: unknown } }).error.payload).toEqual(encodedPayload);
        expect((memoryEntry as { error: { payload: unknown } }).error.payload).not.toBe(encodedPayload);

        const memoryError = await captureRejection(service.getFromMemory());
        const customError = await captureRejection(service.getFromCustomProvider());
        expect(memoryError).toBeInstanceOf(DomainError);
        expect(customError).toBeInstanceOf(DomainError);
        expect(encode).toHaveBeenCalledTimes(2);
        expect(decode).toHaveBeenCalledTimes(2);
        expect(memoryCalls).toBe(1);
        expect(customCalls).toBe(1);
    });

    it('自定义 encode 抛错时跳过写入并保留业务异常', async () => {
        const provider = createProvider();
        CacheProviderRegistry.register('failed-encode', provider.provider);
        const businessError = new Error('business failure');
        const codecError = new Error('codec secret');
        const codec: CacheErrorCodec = {
            encode: (): never => {
                throw codecError;
            },
            decode: (payload: unknown): unknown => payload,
        };

        class UserService {
            @Cache('failed-encode-users', { providerName: 'failed-encode', errorCache: { ttl: 5, codec } })
            async getUser(): Promise<never> {
                throw businessError;
            }
        }

        await expect(new UserService().getUser()).rejects.toBe(businessError);
        expect(provider.set).not.toHaveBeenCalled();
    });

    it('共享 key 的 codec 不匹配或 decode 返回非法结果时旁路为 miss', async () => {
        const cases: ReadonlyArray<readonly [string, (payload: unknown) => unknown]> = [
            [
                'mismatch',
                (): never => {
                    throw new TypeError('codec mismatch');
                },
            ],
            ['invalid-result', (): unknown => (): void => undefined],
        ];

        for (const [label, decode] of cases) {
            const provider = createProvider();
            const providerName = `decode-${label}`;
            const cacheName = `decode-${label}-users`;
            provider.values.set(KeyBuilder.build(cacheName, []), currentErrorEntry({ code: 'OTHER_CODEC' }));
            CacheProviderRegistry.register(providerName, provider.provider);
            const businessMethod = jest.fn(() => 'fresh');

            class UserService {
                @Cache(cacheName, {
                    providerName,
                    errorCache: { ttl: 5, codec: { encode: (error: unknown): unknown => error, decode } },
                })
                async getUser(): Promise<string> {
                    return businessMethod();
                }
            }

            await expect(new UserService().getUser()).resolves.toBe('fresh');
            expect(businessMethod).toHaveBeenCalledTimes(1);
            expect(provider.set).toHaveBeenCalledWith(expect.any(String), { value: 'fresh' }, undefined);
        }
    });

    it('禁用策略时旁路版本化异常并用成功结果覆盖', async () => {
        const provider = createProvider();
        const cacheName = 'disabled-versioned-error';
        const cacheKey = KeyBuilder.build(cacheName, []);
        provider.values.set(cacheKey, currentErrorEntry({ type: 'error', name: 'Error', message: 'cached' }));
        CacheProviderRegistry.register('disabled-versioned', provider.provider);
        const businessMethod = jest.fn(() => 'fresh');

        class UserService {
            @Cache(cacheName, { providerName: 'disabled-versioned' })
            async getUser(): Promise<string> {
                return businessMethod();
            }
        }

        await expect(new UserService().getUser()).resolves.toBe('fresh');
        expect(businessMethod).toHaveBeenCalledTimes(1);
        expect(provider.values.get(cacheKey)).toEqual({ value: 'fresh' });
    });

    it('legacy error 条目始终旁路，业务失败后按当前策略写入新 envelope', async () => {
        const provider = createProvider();
        const cacheName = 'legacy-error-entry';
        const cacheKey = KeyBuilder.build(cacheName, []);
        provider.values.set(cacheKey, { error: new Error('legacy') });
        CacheProviderRegistry.register('legacy-error', provider.provider);
        const businessError = new Error('current business failure');
        let callCount = 0;

        class UserService {
            @Cache(cacheName, { providerName: 'legacy-error', errorCache: { ttl: 5 } })
            async getUser(): Promise<never> {
                callCount += 1;
                throw businessError;
            }
        }

        const service = new UserService();
        await expect(service.getUser()).rejects.toBe(businessError);
        expect(provider.values.get(cacheKey)).toEqual(
            currentErrorEntry({ type: 'error', name: 'Error', message: 'current business failure' })
        );
        const cachedError = await captureRejection(service.getUser());
        expect((cachedError as Error).message).toBe('current business failure');
        expect(callCount).toBe(1);
    });
});

describe('异常路径 pending 请求合并', () => {
    const pendingCases: ReadonlyArray<{
        readonly label: string;
        readonly error: unknown;
        readonly options: CacheOptions;
    }> = [
        { label: 'disabled', error: new Error('disabled'), options: {} },
        {
            label: 'predicate-rejected',
            error: new Error('predicate rejected'),
            options: { errorCache: { ttl: 5, shouldCache: (): boolean => false } },
        },
        { label: 'encode-failed', error: (): void => undefined, options: { errorCache: { ttl: 5 } } },
    ];

    it.each(pendingCases)('$label 时并发 rejection 复用同一 Promise，settled 后允许重试', async (testCase) => {
        const provider = createProvider();
        const providerName = `pending-${testCase.label}`;
        const cacheName = `pending-${testCase.label}-users`;
        CacheProviderRegistry.register(providerName, provider.provider);
        const deferred = createRejectionDeferred();
        const businessMethod = jest.fn(() => deferred.promise);

        class UserService {
            @Cache(cacheName, { ...testCase.options, providerName })
            getUser(): Promise<never> {
                return businessMethod();
            }
        }

        const service = new UserService();
        const first = service.getUser();
        const second = service.getUser();
        expect(second).toBe(first);
        await Promise.resolve();
        expect(businessMethod).toHaveBeenCalledTimes(1);

        deferred.reject(testCase.error);
        expect(await captureRejection(first)).toBe(testCase.error);
        expect(await captureRejection(second)).toBe(testCase.error);
        const retry = service.getUser();
        expect(await captureRejection(retry)).toBe(testCase.error);
        expect(businessMethod).toHaveBeenCalledTimes(2);
        expect(provider.get).toHaveBeenCalledTimes(2);
        expect(provider.set).not.toHaveBeenCalled();
    });
});
