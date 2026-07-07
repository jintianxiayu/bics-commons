import type { Middleware } from './middleware';

/**
 * traceId 注入配置
 */
export interface TracingOptions {
    /**
     * 注入的请求头名称
     * @default 'x-trace-id'
     */
    headerName?: string;
    /**
     * 自定义 traceId 来源函数
     * 返回 undefined 时跳过注入
     * @default 从 LoggerContext.get('traceId') 读取
     */
    provider?: () => string | undefined;
}

/**
 * debug 日志输出配置
 */
export interface DebugOptions {
    /**
     * 自定义日志输出函数
     * @default 包内 LoggerFactory.getLogger() 的 debug 方法
     */
    logger?: (message: string, meta?: Record<string, unknown>) => void;
    /**
     * 是否输出请求/响应 body
     * @default true
     */
    logBody?: boolean;
    /**
     * 是否输出请求/响应 headers
     * @default true
     */
    logHeaders?: boolean;
}

/**
 * HTTP 客户端配置接口
 *
 * 定义 HTTP 客户端的基础配置信息
 *
 * @param baseURL - 服务端基础地址
 * @param middlewares - 中间件列表（可选）
 * @param timeout - 请求超时时间（毫秒）
 * @param headers - 默认请求头
 * @param tracing - 自动注入 traceId 到请求头（可选）
 * @param debug - 开启请求/响应详情日志输出（可选）
 */
export interface HttpClientConfig {
    baseURL: string;
    middlewares?: Middleware[];
    timeout?: number;
    headers?: Record<string, string>;
    /**
     * 启用 traceId 自动注入
     * - `true`: 使用全部默认配置
     * - `TracingOptions`: 自定义 headerName 或 provider
     */
    tracing?: boolean | TracingOptions;
    /**
     * 启用请求/响应详情日志输出
     * - `true`: 使用全部默认配置
     * - `DebugOptions`: 自定义输出行为
     */
    debug?: boolean | DebugOptions;
}
