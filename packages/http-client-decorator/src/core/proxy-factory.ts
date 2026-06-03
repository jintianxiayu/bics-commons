import type { ParamMetadata } from './param-metadata';
import type { MethodMetadata } from './method-metadata';
import { getMethodMetadata } from '../decorators/http-methods';
import { getParamMetadata } from '../decorators/params';
import type { HttpClientConfig } from './http-client-config';
import { createHttpRequest } from './http-client';
import { executeMiddlewareChain } from './middleware';
import type { HttpContext, Middleware } from './middleware';

/**
 * 创建代理实例
 *
 * 使用 ES Proxy 包装目标对象，拦截所有方法调用
 *
 * @param target - 目标实例
 * @param config - HTTP 客户端配置
 * @returns 代理包装后的实例
 */
export function createProxyInstance<T extends object>(target: T, config: HttpClientConfig): T {
    return new Proxy(target, {
        get(_targetProxy, prop, receiver) {
            const methodMeta = getMethodMetadata(target, prop);
            if (methodMeta) {
                return createHttpMethod(target, prop as string, methodMeta, config);
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

/**
 * 创建 HTTP 方法处理函数
 *
 * 包装方法调用，执行参数映射、中间件链和 HTTP 请求
 *
 * @param instanceTarget - 实例目标对象
 * @param propertyKey - 方法属性名
 * @param methodMeta - 方法元数据
 * @param config - HTTP 客户端配置
 * @returns 异步方法函数
 */
function createHttpMethod(
    instanceTarget: object,
    propertyKey: string,
    methodMeta: MethodMetadata,
    config: HttpClientConfig
): (...args: unknown[]) => Promise<unknown> {
    return async function (...args: unknown[]): Promise<unknown> {
        const paramMeta = getParamMetadata(instanceTarget, propertyKey);
        const { url, body, headers } = buildRequestParts(paramMeta, args, methodMeta, config);

        const middlewares: Middleware[] = config.middlewares ?? [];
        const httpClient = createHttpRequest(config);

        const ctx: HttpContext = {
            request: {
                method: methodMeta.method,
                url,
                headers,
                body,
            },
            state: {},
        };

        const handler = async (): Promise<void> => {
            const result = await httpClient(ctx.request);
            ctx.response = result;
        };

        await executeMiddlewareChain(ctx, middlewares, handler);
        return ctx.response?.data;
    };
}

/**
 * 构建请求组成部分
 *
 * 从参数元数据和方法参数中提取 URL、Body 和 Headers
 *
 * @param paramMeta - 参数元数据数组
 * @param args - 方法实际参数
 * @param methodMeta - 方法元数据
 * @param config - HTTP 客户端配置
 * @returns 请求的各部分数据
 */
function buildRequestParts(
    paramMeta: ParamMetadata[],
    args: unknown[],
    methodMeta: MethodMetadata,
    config: HttpClientConfig
): { url: string; body?: unknown; headers: Record<string, string> } {
    let path = methodMeta.path;
    const query: Record<string, string> = {};
    let body: unknown;
    const headers: Record<string, string> = { ...config.headers };

    for (const param of paramMeta) {
        const value = args[param.paramIndex];
        switch (param.paramType) {
            case 'path':
                path = path.replace(`:${param.paramName}`, String(value));
                break;
            case 'query':
                if (param.paramName && value !== undefined) {
                    query[param.paramName] = String(value);
                }
                break;
            case 'body':
                body = value;
                break;
            case 'header':
                if (param.paramName && value !== undefined) {
                    headers[param.paramName] = String(value);
                }
                break;
        }
    }

    const url = buildUrl(config.baseURL, path, query);
    return { url, body, headers };
}

/**
 * 构建完整 URL
 *
 * 拼接 baseURL、path 和 query 参数
 *
 * @param baseURL - 基础地址
 * @param path - 请求路径
 * @param query - 查询参数对象
 * @returns 完整的 URL 字符串
 */
function buildUrl(baseURL: string, path: string, query: Record<string, string>): string {
    const url = new URL(path, baseURL);
    for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}
