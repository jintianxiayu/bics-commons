import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cachePackage from '../../dist/index.js';

const { Cache, CacheEvict, CacheProviderRegistry } = cachePackage;

/** 将 legacy method decorator 应用到 JavaScript fixture 的指定方法。 */
function decorateMethod(target, methodName, decorator) {
    const descriptor = Object.getOwnPropertyDescriptor(target, methodName);
    assert.ok(descriptor);
    decorator(target, methodName, descriptor);
    Object.defineProperty(target, methodName, descriptor);
}

/** 执行异步写入和删除拒绝场景，进程必须在 strict rejection 模式下正常退出。 */
async function main() {
    const writeError = new Error('async cache write failed');
    const deleteError = new Error('async cache delete failed');
    const writeProvider = {
        get: () => undefined,
        set: () => Promise.reject(writeError),
        delete: () => undefined,
        clear: () => undefined,
        deleteByPattern: () => undefined,
    };
    const deleteProvider = {
        get: () => undefined,
        set: () => undefined,
        delete: () => Promise.reject(deleteError),
        clear: () => undefined,
        deleteByPattern: () => undefined,
    };

    class UserService {
        getUser() {
            return 'business-value';
        }

        updateUser() {
            return 'business-update';
        }
    }

    decorateMethod(UserService.prototype, 'getUser', Cache('failure-fixture-users', { providerName: 'write' }));
    decorateMethod(
        UserService.prototype,
        'updateUser',
        CacheEvict('failure-fixture-users', { providerName: 'delete' })
    );
    CacheProviderRegistry.register('write', writeProvider);
    CacheProviderRegistry.register('delete', deleteProvider);

    try {
        const service = new UserService();
        assert.equal(await service.getUser(), 'business-value');
        assert.equal(await service.updateUser(), 'business-update');
        await new Promise((resolve) => setImmediate(resolve));
    } finally {
        CacheProviderRegistry.clear();
    }
}

const currentFile = fileURLToPath(import.meta.url);
if (currentFile === join(process.cwd(), 'test', 'fixtures', 'cache-provider-failure-child.mjs')) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}
