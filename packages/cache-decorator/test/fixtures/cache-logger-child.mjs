import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cachePackage from '../../dist/index.js';
import loggerPackage from '../../../logger/dist/index.js';

const { Cache, CacheProviderRegistry, MemoryCacheProvider } = cachePackage;
const { LoggerContext, LoggerFactory } = loggerPackage;
const CACHE_LOGGER_NAME = '@jintianxiayu/cache-decorator';
const profileLevel = process.argv[2];
const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureRequire = createRequire(import.meta.url);
if (profileLevel !== 'debug' && profileLevel !== 'error') {
    throw new Error('Expected cache Logger profile level: debug or error');
}

/** 将 legacy method decorator 应用到 JavaScript fixture 的指定方法。 */
function decorateMethod(target, methodName, decorator) {
    const descriptor = Object.getOwnPropertyDescriptor(target, methodName);
    assert.ok(descriptor);
    decorator(target, methodName, descriptor);
    Object.defineProperty(target, methodName, descriptor);
}

/** 在应用初始化 Logger 后执行正常缓存和 Provider 失败调用。 */
async function main() {
    LoggerFactory.init({
        root: {
            level: 'error',
            console: { enabled: false, colors: false, format: 'json' },
            file: { enabled: false },
        },
        loggers: {
            [CACHE_LOGGER_NAME]: {
                level: profileLevel,
                console: { enabled: true, colors: false, format: 'json' },
                file: { enabled: false },
            },
        },
        masking: { enabled: true },
        processErrors: {
            uncaughtException: false,
            unhandledRejection: false,
            exitOnError: false,
        },
    });

    const cachePackageRoot = resolve(fixtureDirectory, '../..');
    const requireFromCache = createRequire(join(cachePackageRoot, 'package.json'));
    const directLoggerEntry = fixtureRequire.resolve('@jintianxiayu/logger');
    const cacheLoggerEntry = requireFromCache.resolve('@jintianxiayu/logger');
    assert.equal(realpathSync(directLoggerEntry), realpathSync(cacheLoggerEntry));
    const namedLogger = LoggerFactory.getLogger(CACHE_LOGGER_NAME);

    const memoryProvider = new MemoryCacheProvider();
    const providerError = Object.assign(new Error('redis unavailable'), {
        password: 'provider-password-secret',
        email: 'provider@example.com',
    });
    const failingProvider = {
        get: async () => {
            throw providerError;
        },
        set: () => undefined,
        delete: () => undefined,
        clear: () => undefined,
        deleteByPattern: () => undefined,
    };

    class SuccessService {
        getUser() {
            return { id: 17, password: 'business-value-secret' };
        }
    }
    decorateMethod(SuccessService.prototype, 'getUser', Cache('fixture-users', { providerName: 'memory' }));

    class FailureService {
        getUser() {
            return { id: 18, source: 'business-bypass' };
        }
    }
    decorateMethod(FailureService.prototype, 'getUser', Cache('fixture-failure-users', { providerName: 'failing' }));

    CacheProviderRegistry.register('memory', memoryProvider);
    CacheProviderRegistry.register('failing', failingProvider);
    try {
        const result = await LoggerContext.withContext({ traceId: 'cache-fixture-trace' }, () =>
            new SuccessService().getUser()
        );
        assert.deepEqual(result, { id: 17, password: 'business-value-secret' });

        const bypassResult = await LoggerContext.withContext({ traceId: 'cache-fixture-trace' }, () =>
            new FailureService().getUser()
        );
        assert.deepEqual(bypassResult, { id: 18, source: 'business-bypass' });
        assert.strictEqual(LoggerFactory.getLogger(CACHE_LOGGER_NAME), namedLogger);
    } finally {
        CacheProviderRegistry.clear();
        await LoggerFactory.shutdown({ timeout: 2_000 });
    }
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
