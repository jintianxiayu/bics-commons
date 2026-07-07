import 'reflect-metadata';
import { LoggerContext } from '@jintianxiayu/logger';
import { executeMiddlewareChain } from '../src';
import { createTracingMiddleware } from '../src/middlewares/tracing';
import { createDebugMiddleware } from '../src/middlewares/debug';
import type { HttpContext, Middleware } from '../src';

function makeCtx(headers: Record<string, string> = {}): HttpContext {
    return {
        request: {
            method: 'GET',
            url: 'https://example.com/api/test',
            headers,
            body: undefined,
        },
        state: {},
    };
}

afterEach(() => {
    LoggerContext.clear();
});

describe('集成测试：tracing + debug 同时启用', () => {
    it('debug 输出的请求 headers 中包含已注入的 traceId', async () => {
        LoggerContext.set('traceId', 'integrated-trace-001');

        const capturedRequestMeta: Record<string, unknown>[] = [];
        const ctx = makeCtx();

        const tracingMw = createTracingMiddleware({});
        const debugMw = createDebugMiddleware({
            logger: (msg, meta) => {
                if (msg === 'HTTP Request') capturedRequestMeta.push(meta ?? {});
            },
        });

        const finalHandler = async () => {
            ctx.response = { status: 200, headers: {}, data: null };
        };

        await executeMiddlewareChain(ctx, [tracingMw, debugMw], finalHandler);

        expect(capturedRequestMeta).toHaveLength(1);
        const capturedHeaders = capturedRequestMeta[0]!.headers as Record<string, string>;
        expect(capturedHeaders['x-trace-id']).toBe('integrated-trace-001');
    });
});

describe('集成测试：内置 middleware + 用户自定义 middleware 执行顺序', () => {
    it('执行顺序为 tracing → debug → user middleware', async () => {
        LoggerContext.set('traceId', 'order-trace-002');

        const order: string[] = [];
        const ctx = makeCtx();

        const tracingMw = createTracingMiddleware({});
        const debugMw = createDebugMiddleware({
            logger: (msg) => {
                if (msg === 'HTTP Request') order.push('debug:request');
                if (msg === 'HTTP Response') order.push('debug:response');
            },
        });

        const userMw: Middleware = async (_c, next) => {
            order.push('user:before');
            await next();
            order.push('user:after');
        };

        const finalHandler = async () => {
            order.push('send');
            ctx.response = { status: 200, headers: {}, data: null };
        };

        await executeMiddlewareChain(ctx, [tracingMw, debugMw, userMw], finalHandler);

        expect(order).toEqual([
            'debug:request',
            'user:before',
            'send',
            'user:after',
            'debug:response',
        ]);
    });

    it('tracing 注入的 header 对 user middleware 可见', async () => {
        LoggerContext.set('traceId', 'visible-trace-003');

        let seenTraceId: string | undefined;
        const ctx = makeCtx();

        const tracingMw = createTracingMiddleware({});
        const userMw: Middleware = async (c, next) => {
            seenTraceId = (c.request.headers as Record<string, string>)['x-trace-id'];
            await next();
        };

        const finalHandler = async () => {
            ctx.response = { status: 200, headers: {}, data: null };
        };

        await executeMiddlewareChain(ctx, [tracingMw, userMw], finalHandler);

        expect(seenTraceId).toBe('visible-trace-003');
    });
});
