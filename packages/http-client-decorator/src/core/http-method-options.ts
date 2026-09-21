import type { IAxiosRetryConfig } from 'axios-retry';

/**
 * HTTP 方法配置。
 *
 * 直接使用 axios-retry 的公开配置，调用方可以按方法覆盖完整的原生重试策略。
 */
export interface HttpMethodOptions {
    retry?: IAxiosRetryConfig;
}
