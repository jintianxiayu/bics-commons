import { LoggerFactory } from '@jintianxiayu/logger';
import type { Middleware } from '../core/middleware';
import type { DebugOptions } from '../core/http-client-config';

const builtinLogger = LoggerFactory.getLogger('@jintianxiayu/http-client-decorator');

/**
 * 创建 debug 日志中间件
 *
 * 在请求前后输出完整的请求/响应详情，包含 method、url、headers、body、status 和耗时。
 * 默认使用包内 Logger，可通过 options.logger 自定义输出函数。
 *
 * @param options - debug 配置
 * @returns Middleware
 */
export function createDebugMiddleware(options: DebugOptions): Middleware {
    const logFn =
        options.logger ??
        ((message: string, meta?: Record<string, unknown>) => builtinLogger.debug(message, meta));
    const logBody = options.logBody ?? true;
    const logHeaders = options.logHeaders ?? true;

    return async (ctx, next) => {
        const startTime = Date.now();
        const { method, url, headers, body } = ctx.request;

        const requestMeta: Record<string, unknown> = { method, url };
        if (logHeaders) requestMeta.headers = headers;
        if (logBody && body !== undefined) requestMeta.body = body;
        logFn('HTTP Request', requestMeta);

        try {
            await next();
        } catch (error) {
            const duration = Date.now() - startTime;
            logFn('HTTP Error', { method, url, error: String(error), duration });
            throw error;
        }

        const duration = Date.now() - startTime;
        const { response } = ctx;
        const responseMeta: Record<string, unknown> = { method, url, status: response?.status, duration };
        if (logHeaders) responseMeta.headers = response?.headers;
        if (logBody) responseMeta.body = response?.data;
        logFn('HTTP Response', responseMeta);
    };
}
