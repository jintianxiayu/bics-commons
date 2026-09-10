import { LoggerContext, LoggerFactory } from '../../src';

const configPath = process.argv[2];
if (!configPath) {
    throw new Error('Missing logger configuration path');
}
process.env.LOGGER_CONFIG_PATH = configPath;

const logger = LoggerFactory.getLogger('console');
const isOptOutFixture = process.argv[3] === 'opt-out';
const metadata = { password: 'console-secret', token: 'console-token-secret', statusCode: 201 };
LoggerContext.withContext({ traceId: 'console-trace' }, () => {
    logger.info(isOptOutFixture ? 'message password=message-secret' : 'console event', metadata);
});
if (metadata.password !== 'console-secret' || metadata.token !== 'console-token-secret') {
    throw new Error('Logger mutated caller metadata');
}

void LoggerFactory.shutdown({ timeout: 2_000 }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.name : 'UnknownError'}\n`);
    process.exitCode = 1;
});
