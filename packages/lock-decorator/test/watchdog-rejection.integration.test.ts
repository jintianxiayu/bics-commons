import { join, resolve } from 'node:path';
import { packageRoot, runCommand } from './helpers/package-consumer';

const loggerRoot = resolve(packageRoot, '../logger');
const fixture = join(__dirname, 'fixtures', 'watchdog-rejection-child.mjs');

beforeAll(() => {
    runCommand({
        executable: process.execPath,
        args: [require.resolve('typescript/bin/tsc'), '-p', loggerRoot],
        cwd: loggerRoot,
    });
    runCommand({
        executable: process.execPath,
        args: [require.resolve('typescript/bin/tsc'), '-p', packageRoot],
        cwd: packageRoot,
    });
});

it('lock-operation-logging/续期 Promise 拒绝', () => {
    const result = JSON.parse(
        runCommand({ executable: process.execPath, args: [fixture], cwd: packageRoot })
    ) as Record<string, unknown>;

    expect(result).toEqual({
        result: 'business-completed',
        renewCalls: 1,
        releaseCalls: 1,
        unhandledRejections: 0,
    });
});
