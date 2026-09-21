import axios, { type AxiosRequestConfig, AxiosError } from 'axios';
import axiosRetry, { type IAxiosRetryConfig } from 'axios-retry';
import { HttpError } from './http-error';
import type { HttpContext } from './middleware';

interface HttpResponse {
    status: number;
    headers: Record<string, string>;
    data: unknown;
}

export type HttpRequestSender = (
    request: HttpContext['request'],
    retry: IAxiosRetryConfig | undefined
) => Promise<HttpResponse>;

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
): HttpRequestSender {
    const client = axios.create();
    const clientDefaults = client.defaults as typeof client.defaults & { 'axios-retry'?: unknown };
    delete clientDefaults['axios-retry'];
    axiosRetry(client);

    return async function sendRequest(
        request: HttpContext['request'],
        retry: IAxiosRetryConfig | undefined
    ): Promise<HttpResponse> {
        const axiosConfig: AxiosRequestConfig = {
            method: request.method,
            url: request.url,
            headers: request.headers,
            data: request.body,
            timeout: config.timeout,
            validateStatus: (status) => status < 400,
            'axios-retry': retry === undefined ? { retries: 0 } : { ...retry },
        };

        try {
            const response = await client(axiosConfig);

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
                if (error.response) {
                    throw new HttpError(
                        error.response.status,
                        error.response.data,
                        `HTTP ${error.response.status}: ${request.url}`
                    );
                }
                throw new HttpError(0, error.message, error.message);
            }
            throw error;
        }
    };
}
