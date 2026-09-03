import 'reflect-metadata';
import axios from 'axios';
import { LoggerContext } from '@jintianxiayu/logger';
import { HttpClient, Get, executeMiddlewareChain, type HttpContext, type Middleware } from '../src';
import { createTracingMiddleware } from '../src/middlewares/tracing';
import { createDebugMiddleware } from '../src/middlewares/debug';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

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

describe('集成测试：tracing + debug 同时启用', () => {
    it('debug 输出的请求 headers 中包含已注入的 traceId', async () => {
        await LoggerContext.withContext({ traceId: 'integrated-trace-001' }, async () => {
            const capturedRequestMeta: Record<string, unknown>[] = [];
            const ctx = makeCtx();

            const tracingMw = createTracingMiddleware({});
            const debugMw = createDebugMiddleware({
                logger: (msg, meta) => {
                    if (msg === 'HTTP Request') {
                        capturedRequestMeta.push(meta ?? {});
                    }
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
});

describe('集成测试：内置 middleware + 用户自定义 middleware 执行顺序', () => {
    it('执行顺序为 tracing → debug → user middleware', async () => {
        const order: string[] = [];
        const userMiddleware: Middleware = async (_ctx, next) => {
            order.push('user:before');
            await next();
            order.push('user:after');
        };
        mockedAxios.mockReset();
        mockedAxios.mockImplementation(async () => {
            order.push('send');
            return { status: 200, headers: {}, data: null } as never;
        });

        @HttpClient({
            baseURL: 'https://example.com',
            tracing: {
                provider: () => {
                    order.push('tracing');
                    return 'order-trace-002';
                },
            },
            debug: {
                logger: (message) => {
                    if (message === 'HTTP Request') {
                        order.push('debug:request');
                    }
                    if (message === 'HTTP Response') {
                        order.push('debug:response');
                    }
                },
            },
            middlewares: [userMiddleware],
        })
        class TestService {
            @Get('/api/test')
            async get(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        await new TestService().get();

        expect(order).toEqual(['tracing', 'debug:request', 'user:before', 'send', 'user:after', 'debug:response']);
    });

    it('tracing 注入的 header 对 user middleware 可见', async () => {
        await LoggerContext.withContext({ traceId: 'visible-trace-003' }, async () => {
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
});
