import { LoggerContext, LoggerFactory } from '../../src';

const configPath = process.argv[2];
if (!configPath) {
    throw new Error('Missing logger configuration path');
}
process.env.LOGGER_CONFIG_PATH = configPath;

const logger = LoggerFactory.getLogger('console');
LoggerContext.withContext({ traceId: 'console-trace' }, () => {
    logger.info('console event', { password: 'console-secret', statusCode: 201 });
});

void LoggerFactory.shutdown({ timeout: 2_000 }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.name : 'UnknownError'}\n`);
    process.exitCode = 1;
});
