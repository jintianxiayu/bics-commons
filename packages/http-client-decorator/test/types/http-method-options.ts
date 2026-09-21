import { Delete, Get, Patch, Post, Put, type HttpMethodOptions } from '../../src';

const completeRetry: NonNullable<HttpMethodOptions['retry']> = {
    retries: 2,
    shouldResetTimeout: true,
    retryCondition: async () => true,
    retryDelay: (retryCount) => retryCount * 10,
    onRetry: async () => undefined,
    onMaxRetryTimesExceeded: async () => undefined,
    validateResponse: (response) => response.status === 503,
};

export class RetryTypeClient {
    @Get('/get', { retry: completeRetry })
    get(): void {}

    @Post('/post', { retry: {} })
    post(): void {}

    @Put('/put', { retry: { retries: 1 } })
    put(): void {}

    @Delete('/delete')
    delete(): void {}

    @Patch('/patch', { retry: undefined })
    patch(): void {}

    // @ts-expect-error retries 必须是 number
    @Get('/invalid-retries', { retry: { retries: '2' } })
    invalidRetries(): void {}

    // @ts-expect-error retryCondition 必须返回 boolean 或 Promise<boolean>
    @Get('/invalid-condition', { retry: { retryCondition: () => 'yes' } })
    invalidCondition(): void {}

    // @ts-expect-error retryCount 是插件运行状态，不是公开配置
    @Get('/runtime-count', { retry: { retryCount: 1 } })
    runtimeCount(): void {}

    // @ts-expect-error lastRequestTime 是插件运行状态，不是公开配置
    @Get('/runtime-time', { retry: { lastRequestTime: Date.now() } })
    runtimeTime(): void {}
}
