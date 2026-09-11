import assert from 'node:assert/strict';
import { stringify } from 'yaml';
import { ConfigLoader } from '../../src/core/ConfigLoader';
import { LoggerConfigError } from '../../src/core/errors';
import type { LoggerConfig } from '../../src/types';
import { createTempDirectory, removeTempDirectory, writeConfig } from '../helpers';

let directory: string;
beforeEach(() => {
    directory = createTempDirectory('logger-profiles-');
});
afterEach(() => {
    removeTempDirectory(directory);
});

const config: LoggerConfig = {
    root: { level: 'warn', captureLogPosition: false, console: { colors: false } },
    loggers: { orders: { level: 'info', console: { pattern: '%{message}' } } },
    profiles: {
        dev: {
            loggers: {
                orders: { level: 'debug' },
                '@jintianxiayu/cache-decorator': { level: 'debug' },
                Orders: { level: 'error' },
            },
        },
        qa: { loggers: { orders: { level: 'debug' } } },
        prod: { loggers: { orders: { level: 'info' }, unused: { level: 'error' } } },
    },
};

test.each(['object', 'yaml'])('P01 P02 P08 P09 P10: %s profiles preserve inheritance and inputs', (source) => {
    const input = JSON.parse(JSON.stringify(config)) as LoggerConfig;
    const before = JSON.parse(JSON.stringify(input)) as LoggerConfig;
    const loader = new ConfigLoader({ cwd: directory, env: { LOGGER_PROFILE: 'dev' } });
    const loaded = loader.load(source === 'object' ? input : writeConfig(directory, stringify(input)));
    const baseline = new ConfigLoader({ cwd: directory, env: {} }).load(input);
    assert.equal(loaded.root.level, 'warn');
    assert.deepEqual(loaded.loggers.get('orders'), { ...baseline.loggers.get('orders'), level: 'debug' });
    assert.deepEqual(loaded.loggers.get('@jintianxiayu/cache-decorator'), { ...baseline.root, level: 'debug' });
    assert.equal(loaded.loggers.get('Orders')?.level, 'error');
    assert.equal(loaded.loggers.has('unused'), false);
    assert.deepEqual(loaded.masking, baseline.masking);
    assert.deepEqual(loaded.processErrors, baseline.processErrors);
    assert.deepEqual(input, before);
    input.profiles!.dev!.loggers!.orders!.level = 'error';
    assert.equal(loaded.loggers.get('orders')?.level, 'debug');
    assert.ok(Object.isFrozen(loaded.loggers.get('orders')));
});

test.each([{}, { loggers: {} }])('P03: empty selected profile %j is a no-op', (profile) => {
    const loader = new ConfigLoader({ cwd: directory, env: { LOGGER_PROFILE: 'prod' } });
    const loaded = loader.load({ profiles: { prod: profile } });
    assert.equal(loaded.root.level, 'info');
    assert.equal(loaded.loggers.size, 0);
});

test.each(['dev', 'production'])('P03 P05: NODE_ENV=%s does not select a profile', (environment) => {
    const loader = new ConfigLoader({ cwd: directory, env: { NODE_ENV: environment } });
    assert.equal(loader.load(config).loggers.get('orders')?.level, 'info');
    assert.equal(loader.load({ profiles: {} }).root.level, 'info');
});

test.each(['', ' ', ' dev', 'dev ', 'DEV', 'missing', 'dev,qa', 'toString'])('P06: rejects selector %j', (selector) => {
    const loader = new ConfigLoader({ cwd: directory, env: { LOGGER_PROFILE: selector } });
    assert.throws(
        () => loader.load(config),
        (error: unknown) => error instanceof LoggerConfigError && error.message.includes('LOGGER_PROFILE')
    );
    assert.throws(() => loader.load(), LoggerConfigError);
});

test('P07: applies profiles to only the chosen source', () => {
    const path = writeConfig(directory, stringify(config));
    const loader = new ConfigLoader({ cwd: directory, env: { LOGGER_PROFILE: 'qa', LOGGER_CONFIG_PATH: path } });
    assert.equal(loader.load().loggers.get('orders')?.level, 'debug');
    assert.throws(() => loader.load({}), LoggerConfigError);
    assert.throws(() => loader.load('missing.yaml'), LoggerConfigError);
    const explicit = new ConfigLoader({
        cwd: directory,
        env: { LOGGER_PROFILE: 'qa', LOGGER_CONFIG_PATH: 'missing.yaml' },
    });
    assert.equal(explicit.load(config).loggers.get('orders')?.level, 'debug');
    assert.equal(explicit.load(path).loggers.get('orders')?.level, 'debug');
    assert.throws(() => explicit.load(writeConfig(directory, '{}')), LoggerConfigError);
});

// P11：表中字段路径同时验证错误定位，避免依赖整份配置回显。
test.each([
    [null, 'profiles'],
    [[], 'profiles'],
    ['invalid', 'profiles'],
    [{ '': {} }, 'profiles'],
    [{ ' dev': {} }, 'profiles'],
    [{ dev: null }, 'profiles.dev'],
    [{ dev: [] }, 'profiles.dev'],
    [{ dev: { loggers: [] } }, 'profiles.dev.loggers'],
    [{ dev: { loggers: { ' orders ': { level: 'info' } } } }, 'loggers'],
    [{ dev: { loggers: { orders: null } } }, 'orders'],
    [{ dev: { loggers: { orders: {} } } }, 'orders.level'],
    [{ dev: { loggers: { orders: { level: 'verbose' } } } }, 'orders.level'],
    [{ dev: { loggers: { orders: { level: null } } } }, 'orders.level'],
    [{ dev: { loggers: { orders: { level: true } } } }, 'orders.level'],
    [{ dev: { loggers: { orders: { level: 'info', console: {} } } } }, 'console'],
])('P11: rejects malformed profiles %j', (profiles, fieldPath) => {
    const loader = new ConfigLoader({ cwd: directory, env: {} });
    const input = { profiles } as LoggerConfig;
    for (const source of [input, writeConfig(directory, stringify(input))]) {
        assert.throws(
            () => loader.load(source),
            (error: unknown) => error instanceof LoggerConfigError && error.message.includes(String(fieldPath))
        );
    }
});

test.each(['root', 'console', 'file', 'captureLogPosition', 'masking', 'processErrors', 'profiles', 'unknown'])(
    'P11: rejects profile field %s',
    (field) => {
        const input = { profiles: { dev: { [field]: {} } } };
        assert.throws(() => new ConfigLoader({ env: {} }).load(input), LoggerConfigError);
    }
);

test('P11: rejects duplicate YAML keys', () => {
    const path = writeConfig(directory, 'profiles:\n  dev: {}\n  dev: {}\n');
    assert.throws(() => new ConfigLoader({ env: {} }).load(path), LoggerConfigError);
});

test('P12: validates unselected profiles and never hides invalid base values', () => {
    const loader = new ConfigLoader({ env: { LOGGER_PROFILE: 'prod' } });
    assert.throws(
        () => loader.load({ profiles: { prod: {}, dev: { loggers: { orders: {} } } } } as never),
        LoggerConfigError
    );
    assert.throws(() => loader.load({ ...config, loggers: { orders: { level: 'bad' } } } as never), LoggerConfigError);
});

test('P02: uses own profile entries and literal names without prototype lookup', () => {
    const input = JSON.parse(
        '{"profiles":{"__proto__":{"loggers":{"constructor":{"level":"debug"},"a.b":{"level":"error"}}}}}'
    ) as LoggerConfig;
    const loaded = new ConfigLoader({ env: { LOGGER_PROFILE: '__proto__' } }).load(input);
    assert.equal(loaded.loggers.get('constructor')?.level, 'debug');
    assert.equal(loaded.loggers.get('a.b')?.level, 'error');
});
