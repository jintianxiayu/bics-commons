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
import { readReadmeExample } from './helpers/package-consumer';

/**
 * 在包内的虚拟文件位置检查真实依赖类型，不运行客户端构造或建立连接。
 * @param source 消費方 TypeScript 代码。
 * @returns 编译诊断的消息。
 * @throws 编译器或文件系统错误。
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

it('redis-lock-client/C02 ioredis 实例通过真实类型检查', () => {
    expect(
        checkTypes(`
        import type Redis from 'ioredis';
        import type { IoredisLockClientSource } from '../src/core/redis-lock-client';
        import { createIoredisLockClient } from '../src/adapters/ioredis-lock-client';
        import { RedisLockProvider } from '../src/core/redis-lock-provider';
        declare const client: Redis;
        export const accepted: IoredisLockClientSource = client;
        export const provider = new RedisLockProvider(createIoredisLockClient(client));
    `)
    ).toEqual([]);
});

it('redis-lock-client/C03 node-redis 实例通过真实类型检查', () => {
    expect(
        checkTypes(`
        import { createClient } from 'redis';
        import type { NodeRedisLockClientSource } from '../src/core/redis-lock-client';
        import { createNodeRedisLockClient } from '../src/adapters/node-redis-lock-client';
        import { RedisLockProvider } from '../src/core/redis-lock-provider';
        declare const client: ReturnType<typeof createClient>;
        export const accepted: NodeRedisLockClientSource = client;
        export const provider = new RedisLockProvider(createNodeRedisLockClient(client));
    `)
    ).toEqual([]);
});

it.each([
    ['C02', 'ioredis'],
    ['C03', 'node-redis'],
])('redis-lock-client/%s README %s 示例通过严格类型检查', (_scenario, section) => {
    const source = readReadmeExample(section).replaceAll("'@jintianxiayu/lock-decorator'", "'../src'");
    expect(checkTypes(source)).toEqual([]);
});

const invalidCalls = [
    "client.setIfAbsent({ key: 'key', value: 'token' });",
    "client.setIfAbsent({ key: 'key', ttlMs: 1000 });",
    "client.setIfAbsent({ value: 'token', ttlMs: 1000 });",
    "client.eval({ script: 'return 1', keys: [] });",
    "client.eval({ script: 'return 1', arguments: [] });",
    'client.eval({ keys: [], arguments: [] });',
    'client.setIfAbsent(null);',
    'client.eval(undefined);',
    'new RedisLockProvider(ioredis);',
    'new RedisLockProvider(nodeRedis);',
    'new RedisLockProvider(null);',
    'new RedisLockProvider(undefined);',
    'createIoredisLockClient(null);',
    'createIoredisLockClient(undefined);',
    'createNodeRedisLockClient(null);',
    'createNodeRedisLockClient(undefined);',
    'createIoredisLockClient(nodeRedis);',
    'createNodeRedisLockClient(ioredis);',
];

it('redis-lock-client/C04 不完整或错误配对的类型被拒绝', () => {
    const negativeFixture = invalidCalls.map((call) => `// @ts-expect-error 必须拒绝此无效调用\n${call}`).join('\n');
    expect(
        checkTypes(`
        import type Redis from 'ioredis';
        import { createClient } from 'redis';
        import type { RedisLockClient } from '../src/core/redis-lock-client';
        import { RedisLockProvider } from '../src/core/redis-lock-provider';
        import { createIoredisLockClient } from '../src/adapters/ioredis-lock-client';
        import { createNodeRedisLockClient } from '../src/adapters/node-redis-lock-client';
        declare const client: RedisLockClient;
        declare const ioredis: Redis;
        declare const nodeRedis: ReturnType<typeof createClient>;
        ${negativeFixture}
    `)
    ).toEqual([]);
});
