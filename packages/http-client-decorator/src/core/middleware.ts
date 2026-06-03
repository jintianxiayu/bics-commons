/**
 * HTTP 客户端配置接口
 *
 * 定义 HTTP 客户端的基础配置信息，包括服务端地址、中间件、超时设置等
 *
 * @param baseURL - 服务端基础地址
 * @param middlewares - 中间件列表（可选），用于拦截请求/响应
 * @param timeout - 请求超时时间（毫秒）
 * @param headers - 默认请求头
 */
export interface HttpClientConfig {
    baseURL: string;
    middlewares?: readonly Middleware[];
    timeout?: number;
    headers?: Readonly<Record<string, string>>;
}

/**
 * 中间件类型定义
 *
 * 采用 Koa 风格洋葱模型，支持请求前后的拦截处理
 *
 * @param ctx - HTTP 上下文，包含请求、响应、状态和错误信息
 * @param next - 调用下一个中间件的函数
 * @throws 当中间件执行出错时
 */
export type Middleware = (ctx: HttpContext, next: () => Promise<void>) => Promise<void>;

/**
 * HTTP 上下文接口
 *
 * 在中间件链中传递的请求/响应上下文对象
 *
 * @param request - 请求信息
 * @param response - 响应信息（可选），在请求完成后填充
 * @param state - 中间件间共享的状态对象
 * @param error - 错误信息（可选），当请求失败时填充
 */
export interface HttpContext {
    request: Readonly<{
        method: string;
        url: string;
        headers: Readonly<Record<string, string>>;
        body?: unknown;
    }>;
    response?: Readonly<{
        status: number;
        headers: Readonly<Record<string, string>>;
        data: unknown;
    }>;
    state: Record<string, unknown>;
    error?: Error;
}

/**
 * 执行中间件链
 *
 * 按照洋葱模型顺序执行所有中间件，每个中间件在 next() 调用前后有特定的执行时机
 *
 * @param ctx - HTTP 上下文对象
 * @param middlewares - 中间件列表
 * @param finalHandler - 最终处理器（在所有中间件之后执行）
 * @throws 当中间件执行出错时
 */
export async function executeMiddlewareChain(
    ctx: HttpContext,
    middlewares: readonly Middleware[],
    finalHandler: () => Promise<void>
): Promise<void> {
    let currentIndex = 0;

    const next = async (): Promise<void> => {
        if (currentIndex >= middlewares.length) {
            await finalHandler();
            return;
        }
        const currentMiddleware = middlewares[currentIndex];
        currentIndex++;
        if (currentMiddleware) {
            await currentMiddleware(ctx, next);
        } else {
            await finalHandler();
        }
    };

    await next();
}
