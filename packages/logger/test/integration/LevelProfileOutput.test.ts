import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { createTempDirectory, removeTempDirectory, writeConfig } from '../helpers';

test('P04 P08 P15: one YAML selects dev/qa/prod for Console and File in isolated processes', () => {
    const directory = createTempDirectory('logger-profile-output-');
    try {
        const configPath = writeConfig(
            directory,
            stringify({
                root: { level: 'info', captureLogPosition: false, console: { enabled: true, format: 'plain' } },
                loggers: {
                    orders: {
                        console: { format: 'json', colors: false },
                        file: { enabled: true, format: 'json', dirname: './logs', filename: 'profile.log' },
                    },
                },
                profiles: {
                    dev: { loggers: { orders: { level: 'debug' } } },
                    qa: { loggers: { orders: { level: 'debug' } } },
                    prod: { loggers: { orders: { level: 'info' } } },
                },
                processErrors: { uncaughtException: false, unhandledRejection: false, exitOnError: false },
            })
        );
        const script = resolve(__dirname, '../fixtures/level-profile-child.ts');
        const register = require.resolve('ts-node/register/transpile-only');
        for (const profile of ['dev', 'qa', 'prod']) {
            const outputDirectory = createTempDirectory('logger-profile-process-');
            try {
                const result = spawnSync(process.execPath, ['-r', register, script], {
                    cwd: outputDirectory,
                    env: {
                        ...process.env,
                        LOGGER_CONFIG_PATH: configPath,
                        LOGGER_PROFILE: profile,
                        TS_NODE_PROJECT: resolve(__dirname, '../../tsconfig.json'),
                    },
                    encoding: 'utf8',
                    timeout: 10000,
                });
                assert.equal(result.status, 0, result.stderr || String(result.error));
                assert.equal(result.stderr, '');
                const events = result.stdout
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line) as { level: string; name: string; meta: { token: string } });
                assert.deepEqual(
                    events.map((event) => event.level),
                    profile === 'prod' ? ['info'] : ['debug', 'info']
                );
                for (const event of events) {
                    assert.equal(event.name, 'orders');
                    assert.equal(event.meta.token, '********');
                    assert.equal(Object.hasOwn(event, 'logPosition'), false);
                }
                const logDirectory = join(outputDirectory, 'logs');
                const filename = readdirSync(logDirectory).find((name) => name.endsWith('.log'));
                assert.ok(filename);
                const fileEvents = readFileSync(join(logDirectory, filename), 'utf8')
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line));
                assert.deepEqual(fileEvents, events);
            } finally {
                removeTempDirectory(outputDirectory);
            }
        }
    } finally {
        removeTempDirectory(directory);
    }
});
