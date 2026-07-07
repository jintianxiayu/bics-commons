import { LoggerContext } from '@jintianxiayu/logger';
import type { Middleware } from '../core/middleware';
import type { TracingOptions } from '../core/http-client-config';

/**
 * 创建 traceId 注入中间件
 *
 * 在每次请求前从 provider 获取 traceId，并注入到请求头中。
 * 若 provider 返回 undefined，则跳过注入。
 *
 * @param options - tracing 配置
 * @returns Middleware
 */
export function createTracingMiddleware(options: TracingOptions): Middleware {
    const headerName = options.headerName ?? 'x-trace-id';
    const provider = options.provider ?? (() => LoggerContext.get('traceId'));

    return async (ctx, next) => {
        const traceId = provider();
        if (traceId !== undefined) {
            (ctx.request.headers as Record<string, string>)[headerName] = traceId;
        }
        await next();
    };
}
