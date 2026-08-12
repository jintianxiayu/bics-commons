import { LoggerContext } from '@jintianxiayu/logger';
import { createTracingMiddleware } from '../src/middlewares/tracing';
import type { HttpContext } from '../src';

function makeCtx(headers: Record<string, string> = {}): HttpContext {
    return {
        request: { method: 'GET', url: 'https://example.com/api', headers },
        state: {},
    };
}

const noopNext = async () => {};

describe('createTracingMiddleware', () => {
    afterEach(() => {
        LoggerContext.clear();
    });

    describe('默认 provider (LoggerContext)', () => {
        it('LoggerContext 有 traceId 时注入默认 header', async () => {
            await LoggerContext.withContext({ traceId: 'abc-123' }, async () => {
                const ctx = makeCtx();
                const mw = createTracingMiddleware({});

                await mw(ctx, noopNext);

                expect((ctx.request.headers as Record<string, string>)['x-trace-id']).toBe('abc-123');
            });
        });

        it('LoggerContext 无 traceId 时跳过注入', async () => {
            const ctx = makeCtx();
            const mw = createTracingMiddleware({});

            await mw(ctx, noopNext);

            expect((ctx.request.headers as Record<string, string>)['x-trace-id']).toBeUndefined();
        });
    });

    describe('自定义 headerName', () => {
        it('使用自定义 header 名称注入', async () => {
            await LoggerContext.withContext({ traceId: 'xyz-789' }, async () => {
                const ctx = makeCtx();
                const mw = createTracingMiddleware({ headerName: 'x-request-id' });

                await mw(ctx, noopNext);

                const headers = ctx.request.headers as Record<string, string>;
                expect(headers['x-request-id']).toBe('xyz-789');
                expect(headers['x-trace-id']).toBeUndefined();
            });
        });
    });

    describe('自定义 provider', () => {
        it('provider 返回有效值时注入 header', async () => {
            const ctx = makeCtx();
            const mw = createTracingMiddleware({ provider: () => 'custom-456' });

            await mw(ctx, noopNext);

            expect((ctx.request.headers as Record<string, string>)['x-trace-id']).toBe('custom-456');
        });

        it('provider 返回 undefined 时跳过注入', async () => {
            const ctx = makeCtx();
            const mw = createTracingMiddleware({ provider: () => undefined });

            await mw(ctx, noopNext);

            expect((ctx.request.headers as Record<string, string>)['x-trace-id']).toBeUndefined();
        });

        it('自定义 provider 优先于 LoggerContext', async () => {
            await LoggerContext.withContext({ traceId: 'from-context' }, async () => {
                const ctx = makeCtx();
                const mw = createTracingMiddleware({ provider: () => 'from-provider' });

                await mw(ctx, noopNext);

                expect((ctx.request.headers as Record<string, string>)['x-trace-id']).toBe('from-provider');
            });
        });
    });

    it('调用 next()', async () => {
        await LoggerContext.withContext({ traceId: 'next-test' }, async () => {
            const ctx = makeCtx();
            let nextCalled = false;
            const mw = createTracingMiddleware({});

            await mw(ctx, async () => {
                nextCalled = true;
            });

            expect(nextCalled).toBe(true);
        });
    });
});
