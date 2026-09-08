import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import lockPackage from '../../dist/index.js';
import loggerPackage from '../../../logger/dist/index.js';

const { DistributedLock, LockProviderRegistry } = lockPackage;
const { LoggerContext, LoggerFactory } = loggerPackage;
const LOCK_LOGGER_NAME = '@jintianxiayu/lock-decorator';
const profileLevel = process.argv[2];
const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureRequire = createRequire(import.meta.url);
if (profileLevel !== 'debug' && profileLevel !== 'warn') {
    throw new Error('Expected lock Logger profile level: debug or warn');
}

/** 将 legacy method decorator 应用到 JavaScript fixture 的指定异步方法。 */
function decorateMethod(target, methodName, decorator) {
    Reflect.defineMetadata('design:returntype', Promise, target, methodName);
    const descriptor = Object.getOwnPropertyDescriptor(target, methodName);
    assert.ok(descriptor);
    decorator(target, methodName, descriptor);
    Object.defineProperty(target, methodName, descriptor);
}

async function main() {
    LoggerFactory.init({
        root: {
            level: 'error',
            console: { enabled: false, colors: false, format: 'json' },
            file: { enabled: false },
        },
        loggers: {
            [LOCK_LOGGER_NAME]: {
                level: profileLevel,
                console: { enabled: true, colors: false, format: 'json' },
                file: { enabled: false },
            },
        },
        masking: { enabled: true },
        processErrors: { uncaughtException: false, unhandledRejection: false, exitOnError: false },
    });

    const lockPackageRoot = resolve(fixtureDirectory, '../..');
    const requireFromLock = createRequire(join(lockPackageRoot, 'package.json'));
    assert.equal(
        realpathSync(fixtureRequire.resolve('@jintianxiayu/logger')),
        realpathSync(requireFromLock.resolve('@jintianxiayu/logger'))
    );
    const namedLogger = LoggerFactory.getLogger(LOCK_LOGGER_NAME);
    const providerError = Object.assign(new Error('redis unavailable'), {
        password: 'provider-password-secret',
        email: 'provider@example.com',
    });
    const successProvider = {
        acquire: async () => 'provider-token-secret',
        renew: async () => true,
        release: async () => true,
    };
    const contendedProvider = {
        acquire: async () => null,
        renew: async () => true,
        release: async () => true,
    };
    const failingProvider = {
        acquire: async () => {
            throw providerError;
        },
        renew: async () => true,
        release: async () => true,
    };

    class SuccessService {
        async run() {
            return 'business-value-secret';
        }
    }
    decorateMethod(
        SuccessService.prototype,
        'run',
        DistributedLock({ key: 'success-key-secret', ttl: 1000, renewInterval: 1000 })
    );
    class ContendedService {
        async run() {
            throw new Error('contended business must not run');
        }
    }
    decorateMethod(
        ContendedService.prototype,
        'run',
        DistributedLock({ key: 'contended-key-secret', ttl: 1000, renewInterval: 1000 })
    );
    class FailureService {
        async run() {
            throw new Error('failure business must not run');
        }
    }
    decorateMethod(
        FailureService.prototype,
        'run',
        DistributedLock({ key: 'failure-key-secret', ttl: 1000, renewInterval: 1000 })
    );

    LockProviderRegistry.register('success', successProvider);
    LockProviderRegistry.register('contended', contendedProvider);
    LockProviderRegistry.register('failing', failingProvider);
    try {
        await LoggerContext.withContext({ traceId: 'lock-fixture-trace' }, async () => {
            LockProviderRegistry.setDefault('success');
            assert.equal(await new SuccessService().run(), 'business-value-secret');
            LockProviderRegistry.setDefault('contended');
            await assert.rejects(new ContendedService().run(), (error) => error.name === 'LockAcquisitionError');
            LockProviderRegistry.setDefault('failing');
            await assert.rejects(new FailureService().run(), (error) => error === providerError);
        });
        assert.strictEqual(LoggerFactory.getLogger(LOCK_LOGGER_NAME), namedLogger);
    } finally {
        LockProviderRegistry.clear();
        await LoggerFactory.shutdown({ timeout: 2000 });
    }
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
