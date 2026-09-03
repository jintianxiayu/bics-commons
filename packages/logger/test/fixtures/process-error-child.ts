import { LoggerFactory } from '../../src';

const configPath = process.argv[2];
const mode = process.argv[3];
const marker = process.argv[4];
const shouldExit = process.argv[5] === 'true';

if (!configPath || (mode !== 'exception' && mode !== 'rejection') || !marker) {
    throw new Error('Invalid process error fixture arguments');
}

process.env.LOGGER_CONFIG_PATH = configPath;
LoggerFactory.init();
process.stdout.write('READY\n');

if (!shouldExit) {
    setTimeout(() => {
        void LoggerFactory.shutdown({ timeout: 3_000 }).then(
            () => process.exit(0),
            () => process.exit(2)
        );
    }, 300);
}

setImmediate(() => {
    if (mode === 'exception') {
        throw new Error(marker);
    }
    void Promise.reject(new Error(marker));
});
