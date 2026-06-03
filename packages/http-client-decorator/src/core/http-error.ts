/**
 * HTTP 错误类
 *
 * 当 HTTP 请求返回 4xx 或 5xx 状态码时抛出此异常
 *
 * @param status - HTTP 状态码
 * @param data - 响应数据
 * @param message - 错误消息
 */
export class HttpError extends Error {
    public constructor(
        public readonly status: number,
        public readonly data: unknown,
        message: string
    ) {
        super(message);
        this.name = 'HttpError';
    }
}
