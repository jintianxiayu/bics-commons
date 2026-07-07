import axios, { type AxiosRequestConfig, AxiosError } from 'axios';
import { HttpError } from './http-error';
import type { HttpContext } from './middleware';

/**
 * 创建 HTTP 请求函数
 *
 * 根据配置创建发送 HTTP 请求的函数，内部处理错误转换。
 * 调试日志由外层 debug middleware 负责输出。
 *
 * @param config - HTTP 客户端配置
 * @returns 发送请求的函数
 */
export function createHttpRequest(
    config: Readonly<{ baseURL: string; timeout?: number; headers?: Record<string, string> }>
) {
    return async function sendRequest(
        request: HttpContext['request']
    ): Promise<{ status: number; headers: Record<string, string>; data: unknown }> {
        const axiosConfig: AxiosRequestConfig = {
            method: request.method,
            url: request.url,
            headers: request.headers,
            data: request.body,
            timeout: config.timeout,
            validateStatus: () => true,
        };

        try {
            const response = await axios(axiosConfig);

            if (response.status >= 400) {
                throw new HttpError(response.status, response.data, `HTTP ${response.status}: ${request.url}`);
            }

            const responseHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers)) {
                if (typeof value === 'string') {
                    responseHeaders[key] = value;
                }
            }

            return {
                status: response.status,
                headers: responseHeaders,
                data: response.data,
            };
        } catch (error) {
            if (error instanceof HttpError) {
                throw error;
            }
            if (error instanceof AxiosError) {
                throw new HttpError(error.response?.status ?? 0, error.response?.data ?? error.message, error.message);
            }
            throw error;
        }
    };
}
