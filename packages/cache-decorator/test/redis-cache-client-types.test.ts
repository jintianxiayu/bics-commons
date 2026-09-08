import { resolve } from 'node:path';
import {
    createCompilerHost,
    createProgram,
    createSourceFile,
    getPreEmitDiagnostics,
    ModuleKind,
    ModuleResolutionKind,
    ScriptTarget,
} from 'typescript';

/**
 * 在包内虚拟文件位置严格检查消费方源码，不构造客户端或建立连接。
 * @param source 消费方 TypeScript 源码。
 * @returns 编译器产生的全部预发射诊断；空数组表示类型检查通过。
 * @throws 编译器或文件系统读取失败时传播原始错误。
 */
function checkTypes(source: string): readonly unknown[] {
    const file = resolve(__dirname, 'type-consumer.ts');
    const options = {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        target: ScriptTarget.ES2021,
        module: ModuleKind.NodeNext,
        moduleResolution: ModuleResolutionKind.NodeNext,
        types: ['node'],
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
    };
    const host = createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
        if (resolve(name) === file) {
            return createSourceFile(name, source, languageVersion, true);
        }
        return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    };
    return getPreEmitDiagnostics(createProgram([file], options, host)).map((diagnostic) => diagnostic.messageText);
}

it('redis-cache-client/C01 自定义客户端接入统一 Provider', () => {
    expect(
        checkTypes(`
        import { RedisCacheClient, RedisCacheProvider } from '../src';

        const client: RedisCacheClient = {
            get(_key: string): Promise<string | null> {
                return Promise.resolve(null);
            },
            set(_request): Promise<void> {
                return Promise.resolve();
            },
            deleteMany(_keys): Promise<void> {
                return Promise.resolve();
            },
            scan(_request): Promise<{ readonly cursor: string; readonly keys: readonly string[] }> {
                return Promise.resolve({ cursor: '0', keys: [] });
            },
            flushDatabase(): Promise<void> {
                return Promise.resolve();
            },
        };

        export const provider = new RedisCacheProvider(client);
    `)
    ).toEqual([]);
});

it('redis-cache-client/C02 ioredis 实例通过真实类型检查', () => {
    expect(
        checkTypes(`
        import type Redis from 'ioredis';
        import {
            createIoredisCacheClient,
            IoredisCacheClientSource,
            RedisCacheProvider,
        } from '../src';

        declare const client: Redis;
        export const accepted: IoredisCacheClientSource = client;
        export const provider = new RedisCacheProvider(createIoredisCacheClient(client));
    `)
    ).toEqual([]);
});

it('redis-cache-client/C03 node-redis 实例通过真实类型检查', () => {
    expect(
        checkTypes(`
        import { createClient } from 'redis';
        import {
            createNodeRedisCacheClient,
            NodeRedisCacheClientSource,
            RedisCacheProvider,
        } from '../src';

        declare const client: ReturnType<typeof createClient>;
        export const accepted: NodeRedisCacheClientSource = client;
        export const provider = new RedisCacheProvider(createNodeRedisCacheClient(client));
    `)
    ).toEqual([]);
});

const invalidCalls = [
    'new RedisCacheProvider();',
    'new RedisCacheProvider(ioredis);',
    'new RedisCacheProvider(nodeRedis);',
    'new RedisCacheProvider(null);',
    'new RedisCacheProvider(undefined);',
    "cacheClient.set({ value: 'value' });",
    "cacheClient.set({ key: 'key' });",
    "cacheClient.scan({ pattern: '*', count: 100 });",
    "cacheClient.scan({ cursor: '0', count: 100 });",
    "cacheClient.scan({ cursor: '0', pattern: '*' });",
    'cacheClient.set(null);',
    'cacheClient.scan(undefined);',
    'createIoredisCacheClient();',
    'createIoredisCacheClient(null);',
    'createIoredisCacheClient(undefined);',
    'createNodeRedisCacheClient();',
    'createNodeRedisCacheClient(null);',
    'createNodeRedisCacheClient(undefined);',
    'createIoredisCacheClient(nodeRedis);',
    'createNodeRedisCacheClient(ioredis);',
];

it('redis-cache-client/C04 不完整或错误配对的类型被拒绝', () => {
    const negativeFixture = invalidCalls.map((call) => `// @ts-expect-error 必须拒绝此无效调用\n${call}`).join('\n');
    expect(
        checkTypes(`
        import type Redis from 'ioredis';
        import { createClient } from 'redis';
        import {
            createIoredisCacheClient,
            createNodeRedisCacheClient,
            RedisCacheClient,
            RedisCacheProvider,
        } from '../src';

        declare const cacheClient: RedisCacheClient;
        declare const ioredis: Redis;
        declare const nodeRedis: ReturnType<typeof createClient>;
        ${negativeFixture}
    `)
    ).toEqual([]);
});

it('cache-operation-logging/A01 既有 decorator 与 Provider 公共类型不需要日志选项', () => {
    expect(
        checkTypes(`
        import {
            Cache,
            CacheEvict,
            type CacheEvictOptions,
            type CacheOptions,
            type CacheProvider,
        } from '../src';

        const provider: CacheProvider = {
            get: <Value>(_key: string): Value | undefined => undefined,
            set: <Value>(_key: string, _value: Value, _ttl?: number): void => undefined,
            delete: (_key: string): void => undefined,
            clear: (): void => undefined,
            deleteByPattern: (_pattern: string): void => undefined,
        };
        const cache = Cache('contract-cache', { ttl: 60, providerName: 'memory', key: null });
        const evict = CacheEvict('contract-cache', { providerName: 'memory', allEntries: true });
        const invalidCacheOptions: CacheOptions = {
            // @ts-expect-error CacheOptions 不接受第二套日志配置。
            logging: true,
        };
        const invalidEvictOptions: CacheEvictOptions = {
            // @ts-expect-error CacheEvictOptions 不接受 Logger 实例。
            logger: undefined,
        };

        void provider;
        void cache;
        void evict;
        void invalidCacheOptions;
        void invalidEvictOptions;
    `)
    ).toEqual([]);
});
