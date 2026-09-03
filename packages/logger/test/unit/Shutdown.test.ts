import { EventEmitter } from 'node:events';
import type winston from 'winston';
import { LoggerShutdownTimeoutError } from '../../src/core/errors';
import { shutdownWinstonLogger } from '../../src/core/shutdown';

/** 测试替身通过可控的 end 回调模拟 Winston 完成、报错和超时，避免依赖真实传输时序。 */
class FakeLogger extends EventEmitter {
    constructor(private readonly onEnd: () => void) {
        super();
    }

    end(): void {
        this.onEnd();
    }
}

class FakeTransport extends EventEmitter {}

function asLogger(value: FakeLogger): winston.Logger {
    return value as unknown as winston.Logger;
}

function asTransport(value: FakeTransport): winston.transport {
    return value as unknown as winston.transport;
}

describe('shutdownWinstonLogger', () => {
    test('resolves only after finish', async () => {
        let finished = false;
        const logger = new FakeLogger(() => {
            setImmediate(() => {
                finished = true;
                logger.emit('finish');
            });
        });

        await shutdownWinstonLogger(asLogger(logger), [], 500);
        expect(finished).toBe(true);
    });

    test('rejects logger and transport errors', async () => {
        const loggerError = new Error('logger failed');
        const logger = new FakeLogger(() => setImmediate(() => logger.emit('error', loggerError)));
        await expect(shutdownWinstonLogger(asLogger(logger), [], 500)).rejects.toBe(loggerError);

        const transportError = new Error('transport failed');
        const transport = new FakeTransport();
        const transportLogger = new FakeLogger(() => setImmediate(() => transport.emit('error', transportError)));
        await expect(shutdownWinstonLogger(asLogger(transportLogger), [asTransport(transport)], 500)).rejects.toBe(
            transportError
        );
    });

    test('rejects an explicit timeout', async () => {
        const logger = new FakeLogger(() => undefined);
        await expect(shutdownWinstonLogger(asLogger(logger), [], 10)).rejects.toBeInstanceOf(
            LoggerShutdownTimeoutError
        );
    });

    test('rejects when end throws synchronously', async () => {
        const failure = new Error('end failed');
        const logger = new FakeLogger(() => {
            throw failure;
        });
        await expect(shutdownWinstonLogger(asLogger(logger), [], 500)).rejects.toBe(failure);
    });
});
