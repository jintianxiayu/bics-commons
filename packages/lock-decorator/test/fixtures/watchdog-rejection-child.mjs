import assert from 'node:assert/strict';
import loggerPackage from '../../../logger/dist/index.js';
import lockPackage from '../../dist/index.js';

const { LoggerFactory } = loggerPackage;
const { DistributedLock, LockProviderRegistry } = lockPackage;

LoggerFactory.init({
    root: { console: { enabled: false }, file: { enabled: false } },
    processErrors: { uncaughtException: false, unhandledRejection: false, exitOnError: false },
});

const renewError = new Error('renew failed');
let renewCalls = 0;
let releaseCalls = 0;
const unhandled = [];
const onUnhandled = (reason) => unhandled.push(reason);
process.on('unhandledRejection', onUnhandled);

const provider = {
    acquire: async () => 'fixture-token',
    release: async () => {
        releaseCalls += 1;
        return true;
    },
    renew: async () => {
        renewCalls += 1;
        throw renewError;
    },
};
LockProviderRegistry.register('fixture', provider);
LockProviderRegistry.setDefault('fixture');

class Service {
    async run() {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'business-completed';
    }
}

Reflect.defineMetadata('design:returntype', Promise, Service.prototype, 'run');
const descriptor = Object.getOwnPropertyDescriptor(Service.prototype, 'run');
assert.ok(descriptor);
const decorated = DistributedLock({ key: 'fixture-key', ttl: 100, renewInterval: 5 })(
    Service.prototype,
    'run',
    descriptor
);
Object.defineProperty(Service.prototype, 'run', decorated);

try {
    const result = await new Service().run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(result, 'business-completed');
    assert.equal(renewCalls, 1);
    assert.equal(releaseCalls, 1);
    assert.deepEqual(unhandled, []);
    process.stdout.write(JSON.stringify({ result, renewCalls, releaseCalls, unhandledRejections: unhandled.length }));
} finally {
    process.off('unhandledRejection', onUnhandled);
    LockProviderRegistry.clear();
    await LoggerFactory.shutdown({ timeout: 2000 });
}
