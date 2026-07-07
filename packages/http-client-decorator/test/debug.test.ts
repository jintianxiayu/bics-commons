import { createDebugMiddleware } from '../src/middlewares/debug';
import type { HttpContext } from '../src';

function makeCtx(overrides: Partial<HttpContext> = {}): HttpContext {
    return {
        request: {
            method: 'POST',
            url: 'https://example.com/api/users',
            headers: { 'content-type': 'application/json' },
            body: { name: 'Alice' },
        },
        state: {},
        ...overrides,
    };
}

function makeNextWithResponse(ctx: HttpContext) {
    return async () => {
        ctx.response = {
            status: 201,
            headers: { 'content-type': 'application/json' },
            data: { id: 1, name: 'Alice' },
        };
    };
}

describe('createDebugMiddleware', () => {
    describe('完整输出（默认配置）', () => {
        it('记录请求和响应的完整信息', async () => {
            const logs: Array<{ message: string; meta: Record<string, unknown> }> = [];
            const ctx = makeCtx();
            const mw = createDebugMiddleware({
                logger: (msg, meta) => logs.push({ message: msg, meta: meta ?? {} }),
            });

            await mw(ctx, makeNextWithResponse(ctx));

            expect(logs).toHaveLength(2);

            const reqLog = logs[0]!;
            const resLog = logs[1]!;
            expect(reqLog.message).toBe('HTTP Request');
            expect(reqLog.meta.method).toBe('POST');
            expect(reqLog.meta.url).toBe('https://example.com/api/users');
            expect(reqLog.meta.headers).toEqual({ 'content-type': 'application/json' });
            expect(reqLog.meta.body).toEqual({ name: 'Alice' });

            expect(resLog.message).toBe('HTTP Response');
            expect(resLog.meta.status).toBe(201);
            expect(resLog.meta.body).toEqual({ id: 1, name: 'Alice' });
            expect(typeof resLog.meta.duration).toBe('number');
        });
    });

    describe('logBody: false', () => {
        it('请求和响应日志中不包含 body', async () => {
            const logs: Array<{ message: string; meta: Record<string, unknown> }> = [];
            const ctx = makeCtx();
            const mw = createDebugMiddleware({
                logger: (msg, meta) => logs.push({ message: msg, meta: meta ?? {} }),
                logBody: false,
            });

            await mw(ctx, makeNextWithResponse(ctx));

            expect(logs[0]!.meta.body).toBeUndefined();
            expect(logs[1]!.meta.body).toBeUndefined();
        });
    });

    describe('logHeaders: false', () => {
        it('请求和响应日志中不包含 headers', async () => {
            const logs: Array<{ message: string; meta: Record<string, unknown> }> = [];
            const ctx = makeCtx();
            const mw = createDebugMiddleware({
                logger: (msg, meta) => logs.push({ message: msg, meta: meta ?? {} }),
                logHeaders: false,
            });

            await mw(ctx, makeNextWithResponse(ctx));

            expect(logs[0]!.meta.headers).toBeUndefined();
            expect(logs[1]!.meta.headers).toBeUndefined();
        });
    });

    describe('请求失败场景', () => {
        it('抛出错误时输出错误日志并重新抛出', async () => {
            const logs: Array<{ message: string; meta: Record<string, unknown> }> = [];
            const ctx = makeCtx();
            const error = new Error('Network error');
            const mw = createDebugMiddleware({
                logger: (msg, meta) => logs.push({ message: msg, meta: meta ?? {} }),
            });

            await expect(
                mw(ctx, async () => {
                    throw error;
                })
            ).rejects.toThrow('Network error');

            expect(logs).toHaveLength(2);
            expect(logs[1]!.message).toBe('HTTP Error');
            expect(String(logs[1]!.meta.error)).toContain('Network error');
            expect(typeof logs[1]!.meta.duration).toBe('number');
        });
    });

    describe('duration 计算', () => {
        it('响应日志中 duration 为非负数', async () => {
            const logs: Array<{ message: string; meta: Record<string, unknown> }> = [];
            const ctx = makeCtx();
            const mw = createDebugMiddleware({
                logger: (msg, meta) => logs.push({ message: msg, meta: meta ?? {} }),
            });

            await mw(ctx, makeNextWithResponse(ctx));

            const duration = logs[1]!.meta.duration as number;
            expect(duration).toBeGreaterThanOrEqual(0);
        });
    });

    describe('body 为 undefined 时不输出 body 字段', () => {
        it('请求无 body 时请求日志不包含 body', async () => {
            const logs: Array<{ message: string; meta: Record<string, unknown> }> = [];
            const ctx = makeCtx();
            // Override request without body
            (ctx as { request: unknown }).request = {
                method: 'GET',
                url: 'https://example.com/api/users',
                headers: {},
            };
            const mw = createDebugMiddleware({
                logger: (msg, meta) => logs.push({ message: msg, meta: meta ?? {} }),
            });

            await mw(ctx, makeNextWithResponse(ctx));

            expect(logs[0]!.meta.body).toBeUndefined();
        });
    });
});
