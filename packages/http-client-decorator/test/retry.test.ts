import 'reflect-metadata';
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { Get, HttpClient, HttpError, Path, getMethodMetadata, type HttpMethodOptions, type Middleware } from '../src';

interface PlannedResponse {
    status: number;
    data?: unknown;
    headers?: Record<string, string>;
}

type ResponsePlanner = (
    config: InternalAxiosRequestConfig,
    attempt: number
) => PlannedResponse | Promise<PlannedResponse>;

function createSettlingAdapter(planner: ResponsePlanner, attempts: Map<string, number>): AxiosAdapter {
    return async (config) => {
        const url = config.url ?? '';
        const attempt = (attempts.get(url) ?? 0) + 1;
        attempts.set(url, attempt);
        const planned = await planner(config, attempt);
        const response: AxiosResponse = {
            status: planned.status,
            statusText: String(planned.status),
            headers: planned.headers ?? {},
            config,
            data: planned.data,
        };

        if (config.validateStatus === undefined || config.validateStatus(planned.status)) {
            return response;
        }

        throw new AxiosError(
            `Request failed with status code ${planned.status}`,
            'ERR_BAD_RESPONSE',
            config,
            undefined,
            response
        );
    };
}

function setAdapter(planner: ResponsePlanner): Map<string, number> {
    const attempts = new Map<string, number>();
    axios.defaults.adapter = createSettlingAdapter(planner, attempts);
    return attempts;
}

const originalAdapter = axios.defaults.adapter;
const originalTimeout = axios.defaults.timeout;
const originalHeader = axios.defaults.headers.common['x-retry-test'];
const retryDefaults = axios.defaults as typeof axios.defaults & { 'axios-retry'?: HttpMethodOptions['retry'] };
const originalRetryDefaults = retryDefaults['axios-retry'];

afterEach(() => {
    axios.defaults.adapter = originalAdapter;
    axios.defaults.timeout = originalTimeout;
    if (originalHeader === undefined) {
        delete axios.defaults.headers.common['x-retry-test'];
    } else {
        axios.defaults.headers.common['x-retry-test'] = originalHeader;
    }
    if (originalRetryDefaults === undefined) {
        delete retryDefaults['axios-retry'];
    } else {
        retryDefaults['axios-retry'] = originalRetryDefaults;
    }
    jest.restoreAllMocks();
});

describe('方法级重试与实例隔离', () => {
    it('每个客户端对象只创建一个 Axios 实例并供所有方法复用', async () => {
        setAdapter(() => ({ status: 200, data: 'ok' }));
        const createSpy = jest.spyOn(axios, 'create');

        @HttpClient({ baseURL: 'https://api.example.com' })
        class Client {
            @Get('/first')
            first(): Promise<string> {
                throw new Error('Original method should not execute');
            }

            @Get('/second')
            second(): Promise<string> {
                throw new Error('Original method should not execute');
            }
        }

        const firstClient = new Client();
        const secondClient = new Client();
        void firstClient.first;
        void firstClient.first;
        await firstClient.first();
        await firstClient.second();
        await secondClient.first();

        expect(createSpy).toHaveBeenCalledTimes(2);
        for (const result of createSpy.mock.results) {
            const instance = result.value;
            const requestHandlers = (
                instance.interceptors.request as unknown as { handlers: Array<unknown | null> }
            ).handlers.filter(Boolean);
            const responseHandlers = (
                instance.interceptors.response as unknown as { handlers: Array<unknown | null> }
            ).handlers.filter(Boolean);
            expect(requestHandlers).toHaveLength(1);
            expect(responseHandlers).toHaveLength(1);
        }
    });

    it('忽略宿主 axios-retry defaults，并区分关闭与空配置', async () => {
        const hostRetryCondition = jest.fn(() => false);
        const hostOnRetry = jest.fn();
        const hostValidateResponse = jest.fn(() => true);
        const hostOptions: NonNullable<HttpMethodOptions['retry']> = {
            retries: 7,
            retryCondition: hostRetryCondition,
            validateResponse: hostValidateResponse,
            onRetry: hostOnRetry,
        };
        retryDefaults['axios-retry'] = hostOptions;
        const attempts = setAdapter(() => ({ status: 503, data: { unavailable: true } }));

        @HttpClient({ baseURL: 'https://api.example.com' })
        class Client {
            @Get('/off')
            off(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Get('/default', { retry: {} })
            withDefault(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Get('/empty-options', {})
            emptyOptions(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Get('/undefined', { retry: undefined })
            undefinedRetry(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        const client = new Client();
        await expect(client.off()).rejects.toMatchObject({ status: 503 });
        await expect(client.withDefault()).rejects.toMatchObject({ status: 503 });
        await expect(client.emptyOptions()).rejects.toMatchObject({ status: 503 });
        await expect(client.undefinedRetry()).rejects.toMatchObject({ status: 503 });

        expect(attempts.get('https://api.example.com/off')).toBe(1);
        expect(attempts.get('https://api.example.com/default')).toBe(4);
        expect(attempts.get('https://api.example.com/empty-options')).toBe(1);
        expect(attempts.get('https://api.example.com/undefined')).toBe(1);
        expect(hostRetryCondition).not.toHaveBeenCalled();
        expect(hostValidateResponse).not.toHaveBeenCalled();
        expect(hostOnRetry).not.toHaveBeenCalled();
        expect(retryDefaults['axios-retry']).toBe(hostOptions);
    });

    it('继承创建前普通 defaults，但隔离宿主拦截器和创建后修改', async () => {
        axios.defaults.timeout = 123;
        axios.defaults.headers.common['x-retry-test'] = 'before';
        const beforeRequest = jest.fn((config: InternalAxiosRequestConfig) => config);
        const beforeResponse = jest.fn((response: AxiosResponse) => response);
        const beforeRequestId = axios.interceptors.request.use(beforeRequest);
        const beforeResponseId = axios.interceptors.response.use(beforeResponse);
        let capturedConfig: InternalAxiosRequestConfig | undefined;
        setAdapter((config) => {
            capturedConfig = config;
            return { status: 200, data: 'ok' };
        });

        @HttpClient({ baseURL: 'https://api.example.com' })
        class Client {
            @Get('/defaults')
            get(): Promise<string> {
                throw new Error('Original method should not execute');
            }
        }

        const client = new Client();
        axios.defaults.timeout = 999;
        axios.defaults.headers.common['x-retry-test'] = 'after';
        const afterRequest = jest.fn((config: InternalAxiosRequestConfig) => config);
        const afterResponse = jest.fn((response: AxiosResponse) => response);
        const afterRequestId = axios.interceptors.request.use(afterRequest);
        const afterResponseId = axios.interceptors.response.use(afterResponse);

        try {
            await expect(client.get()).resolves.toBe('ok');
        } finally {
            axios.interceptors.request.eject(beforeRequestId);
            axios.interceptors.response.eject(beforeResponseId);
            axios.interceptors.request.eject(afterRequestId);
            axios.interceptors.response.eject(afterResponseId);
        }

        expect(beforeRequest).not.toHaveBeenCalled();
        expect(beforeResponse).not.toHaveBeenCalled();
        expect(afterRequest).not.toHaveBeenCalled();
        expect(afterResponse).not.toHaveBeenCalled();
        expect(capturedConfig?.timeout).toBe(123);
        expect(capturedConfig?.headers.get('x-retry-test')).toBe('before');
        expect(capturedConfig?.adapter).toBe(axios.defaults.adapter);
        expect(axios.defaults.timeout).toBe(999);
        expect(axios.defaults.headers.common['x-retry-test']).toBe('after');
    });

    it('并发调用、不同方法和后续调用各自维护重试状态', async () => {
        const attempts = setAdapter((config, attempt) => {
            const url = config.url ?? '';
            const failures = url.endsWith('/a') ? 1 : url.endsWith('/b') ? 2 : url.endsWith('/off') ? 9 : 1;
            return attempt <= failures ? { status: 503, data: { attempt } } : { status: 200, data: { url, attempt } };
        });
        const retry = {
            retries: 2,
            retryDelay: () => 0,
            retryCondition: (error: AxiosError) => error.response?.status === 503,
        };

        @HttpClient({ baseURL: 'https://api.example.com' })
        class Client {
            @Get('/items/:id', { retry })
            item(@Path('id') _id: string): Promise<{ attempt: number }> {
                throw new Error('Original method should not execute');
            }

            @Get('/off')
            off(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        const metadata = getMethodMetadata(Client.prototype, 'item');
        const client = new Client();
        const otherClient = new Client();
        const [first, second] = await Promise.all([client.item('a'), client.item('b')]);
        await expect(client.off()).rejects.toMatchObject({ status: 503 });
        const later = await client.item('later');
        const other = await otherClient.item('other');

        expect(first.attempt).toBe(2);
        expect(second.attempt).toBe(3);
        expect(later.attempt).toBe(2);
        expect(other.attempt).toBe(2);
        expect(attempts.get('https://api.example.com/items/a')).toBe(2);
        expect(attempts.get('https://api.example.com/items/b')).toBe(3);
        expect(attempts.get('https://api.example.com/off')).toBe(1);
        expect(metadata?.options?.retry).toEqual(retry);
        expect(metadata?.options?.retry).not.toHaveProperty('retryCount');
        expect(metadata?.options?.retry).not.toHaveProperty('lastRequestTime');
    });

    it('支持显式零次、自定义次数、提前成功和条件拒绝', async () => {
        const attempts = setAdapter((config, attempt) => {
            if (config.url?.endsWith('/success')) {
                return attempt === 1 ? { status: 503 } : { status: 200, data: 'ok' };
            }
            return { status: 503 };
        });

        @HttpClient({ baseURL: 'https://api.example.com' })
        class Client {
            @Get('/zero', { retry: { retries: 0 } })
            zero(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Get('/success', { retry: { retries: 2, retryDelay: () => 0 } })
            success(): Promise<string> {
                throw new Error('Original method should not execute');
            }

            @Get('/blocked', { retry: { retries: 2, retryCondition: () => false } })
            blocked(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        const client = new Client();
        await expect(client.zero()).rejects.toMatchObject({ status: 503 });
        await expect(client.success()).resolves.toBe('ok');
        await expect(client.blocked()).rejects.toMatchObject({ status: 503 });

        expect(attempts.get('https://api.example.com/zero')).toBe(1);
        expect(attempts.get('https://api.example.com/success')).toBe(2);
        expect(attempts.get('https://api.example.com/blocked')).toBe(1);
    });
});

describe('响应、回调与中间件语义', () => {
    it('保留默认小于 400 的成功范围并尊重 validateResponse', async () => {
        const attempts = setAdapter((config) => {
            if (config.url?.endsWith('/redirect')) {
                return { status: 304, data: 'cached' };
            }
            if (config.url?.endsWith('/accepted')) {
                return { status: 503, data: 'accepted' };
            }
            return { status: 200, data: 'rejected' };
        });

        @HttpClient({ baseURL: 'https://api.example.com' })
        class Client {
            @Get('/redirect', { retry: { validateResponse: null } })
            redirect(): Promise<string> {
                throw new Error('Original method should not execute');
            }

            @Get('/accepted', { retry: { validateResponse: (response) => response.status === 503 } })
            accepted(): Promise<string> {
                throw new Error('Original method should not execute');
            }

            @Get('/rejected', {
                retry: {
                    retries: 1,
                    retryDelay: () => 0,
                    retryCondition: () => true,
                    validateResponse: () => false,
                },
            })
            rejected(): Promise<string> {
                throw new Error('Original method should not execute');
            }
        }

        const client = new Client();
        await expect(client.redirect()).resolves.toBe('cached');
        await expect(client.accepted()).resolves.toBe('accepted');
        await expect(client.rejected()).rejects.toMatchObject<HttpError>({
            status: 200,
            data: 'rejected',
            message: 'HTTP 200: https://api.example.com/rejected',
        });
        expect(attempts.get('https://api.example.com/redirect')).toBe(1);
        expect(attempts.get('https://api.example.com/accepted')).toBe(1);
        expect(attempts.get('https://api.example.com/rejected')).toBe(2);
    });

    it('保留 HTTP、无响应和 hook 普通异常的最终错误契约', async () => {
        const hookError = new Error('hook failed');
        const existingHttpError = new HttpError(409, { conflict: true }, 'existing');
        axios.defaults.adapter = (async (config) => {
            if (config.url?.endsWith('/existing')) {
                throw existingHttpError;
            }
            if (config.url?.endsWith('/network')) {
                throw new AxiosError('socket failed', 'ECONNRESET', config);
            }
            const response: AxiosResponse = {
                status: 404,
                statusText: '404',
                headers: {},
                config,
                data: { message: 'missing' },
            };
            throw new AxiosError('not found', 'ERR_BAD_RESPONSE', config, undefined, response);
        }) as AxiosAdapter;

        @HttpClient({ baseURL: 'https://api.example.com' })
        class Client {
            @Get('/missing')
            missing(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Get('/network', { retry: { retries: 0 } })
            network(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Get('/hook', { retry: { retries: 0, onMaxRetryTimesExceeded: async () => Promise.reject(hookError) } })
            hook(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Get('/existing')
            existing(): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        const client = new Client();
        await expect(client.missing()).rejects.toMatchObject<HttpError>({
            status: 404,
            data: { message: 'missing' },
            message: 'HTTP 404: https://api.example.com/missing',
        });
        await expect(client.network()).rejects.toMatchObject<HttpError>({
            status: 0,
            data: 'socket failed',
            message: 'socket failed',
        });
        await expect(client.hook()).rejects.toBe(hookError);
        await expect(client.existing()).rejects.toBe(existingHttpError);
    });

    it('等待异步条件与 hook，并按 shouldResetTimeout 处理预算', async () => {
        const events: string[] = [];
        const attempts = setAdapter((config, attempt) => {
            events.push(`attempt:${attempt}:${config.timeout}`);
            return attempt === 1 ? { status: 503 } : { status: 200, data: 'ok' };
        });

        @HttpClient({ baseURL: 'https://api.example.com', timeout: 10 })
        class Client {
            @Get('/budget', {
                retry: {
                    retries: 1,
                    retryDelay: () => 20,
                    retryCondition: async () => {
                        events.push('condition');
                        return true;
                    },
                    onRetry: async () => {
                        await Promise.resolve();
                        events.push('onRetry');
                    },
                },
            })
            budget(): Promise<string> {
                throw new Error('Original method should not execute');
            }

            @Get('/reset', {
                retry: {
                    retries: 1,
                    retryDelay: () => 0,
                    shouldResetTimeout: true,
                    retryCondition: async () => true,
                    onRetry: async () => {
                        await Promise.resolve();
                        events.push('reset:onRetry');
                    },
                },
            })
            reset(): Promise<string> {
                throw new Error('Original method should not execute');
            }
        }

        const client = new Client();
        await expect(client.budget()).rejects.toMatchObject({ status: 503 });
        await expect(client.reset()).resolves.toBe('ok');

        expect(attempts.get('https://api.example.com/budget')).toBe(1);
        expect(attempts.get('https://api.example.com/reset')).toBe(2);
        expect(events).toContain('condition');
        expect(events).not.toContain('onRetry');
        expect(events).toContain('reset:onRetry');
        expect(events.filter((event) => event.startsWith('attempt:')).every((event) => event.endsWith(':10'))).toBe(
            true
        );
    });

    it('内置延迟遵循 Retry-After，自定义延迟保持自身返回值', async () => {
        setAdapter((_config, attempt) =>
            attempt === 1 ? { status: 503, headers: { 'retry-after': '0.01' } } : { status: 200, data: 'ok' }
        );

        @HttpClient({ baseURL: 'https://api.example.com' })
        class Client {
            @Get('/builtin', { retry: { retries: 1 } })
            builtin(): Promise<string> {
                throw new Error('Original method should not execute');
            }

            @Get('/custom', { retry: { retries: 1, retryDelay: () => 0 } })
            custom(): Promise<string> {
                throw new Error('Original method should not execute');
            }
        }

        const client = new Client();
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        await client.builtin();
        const builtinDelays = setTimeoutSpy.mock.calls.map((call) => call[1]);
        setTimeoutSpy.mockClear();
        await client.custom();
        const customDelays = setTimeoutSpy.mock.calls.map((call) => call[1]);

        expect(builtinDelays).toContain(10);
        expect(customDelays).toContain(0);
    });

    it('重试期间只执行一轮 tracing、debug 和用户 middleware', async () => {
        const order: string[] = [];
        const logs: Array<{ message: string; meta?: Record<string, unknown> }> = [];
        const attempts = setAdapter((_config, attempt) => {
            order.push(`attempt:${attempt}`);
            return attempt === 1 ? { status: 503 } : { status: 200, data: 'ok' };
        });
        const userMiddleware: Middleware = async (_ctx, next) => {
            order.push('user:before');
            await next();
            order.push('user:after');
        };

        @HttpClient({
            baseURL: 'https://api.example.com',
            tracing: {
                provider: () => {
                    order.push('tracing');
                    return 'trace-id';
                },
            },
            debug: {
                logger: (message, meta) => {
                    logs.push({ message, meta });
                    order.push(`debug:${message}`);
                },
            },
            middlewares: [userMiddleware],
        })
        class Client {
            @Get('/retry', { retry: { retries: 1, retryDelay: () => 5 } })
            get(): Promise<string> {
                throw new Error('Original method should not execute');
            }
        }

        await expect(new Client().get()).resolves.toBe('ok');

        expect(order).toEqual([
            'tracing',
            'debug:HTTP Request',
            'user:before',
            'attempt:1',
            'attempt:2',
            'user:after',
            'debug:HTTP Response',
        ]);
        expect(attempts.get('https://api.example.com/retry')).toBe(2);
        expect(logs.map((entry) => entry.message)).toEqual(['HTTP Request', 'HTTP Response']);
        expect(logs[1]?.meta?.duration).toEqual(expect.any(Number));
        expect(logs[1]?.meta?.duration as number).toBeGreaterThanOrEqual(4);
    });

    it('middleware 短路时不发送请求或触发重试', async () => {
        const attempts = setAdapter(() => ({ status: 503 }));
        const shortCircuit: Middleware = async (ctx) => {
            ctx.response = { status: 200, headers: {}, data: 'cached' };
        };

        @HttpClient({
            baseURL: 'https://api.example.com',
            middlewares: [shortCircuit],
        })
        class Client {
            @Get('/short-circuit', { retry: { retries: 2 } })
            get(): Promise<string> {
                throw new Error('Original method should not execute');
            }
        }

        await expect(new Client().get()).resolves.toBe('cached');
        expect(attempts.size).toBe(0);
    });
});
