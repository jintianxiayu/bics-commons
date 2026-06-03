import type { Middleware } from './middleware';

/**
 * HTTP 客户端配置接口
 *
 * 定义 HTTP 客户端的基础配置信息
 *
 * @param baseURL - 服务端基础地址
 * @param middlewares - 中间件列表（可选）
 * @param timeout - 请求超时时间（毫秒）
 * @param headers - 默认请求头
 */
export interface HttpClientConfig {
    baseURL: string;
    middlewares?: Middleware[];
    timeout?: number;
    headers?: Record<string, string>;
}
