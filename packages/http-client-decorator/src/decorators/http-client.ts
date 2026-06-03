import 'reflect-metadata';
import type { HttpClientConfig } from '../core/http-client-config';
import { createProxyInstance } from '../core/proxy-factory';

const HTTP_CLIENT_CONFIG_KEY = Symbol.for('bics:http-client:config');

/**
 * HTTP 客户端类装饰器
 *
 * 标记一个类为 HTTP 客户端服务类，返回代理实例而非原实例
 *
 * @param config - HTTP 客户端配置
 * @returns 类装饰器
 */
export function HttpClient(config: HttpClientConfig) {
    return function <T extends new (...args: unknown[]) => object>(Target: T): T {
        Reflect.defineMetadata(HTTP_CLIENT_CONFIG_KEY, config, Target);

        const DecoratedConstructor = function (...args: unknown[]): object {
            const instance = new Target(...args);
            return createProxyInstance(instance, config);
        } as unknown as T;

        DecoratedConstructor.prototype = Target.prototype;
        Object.setPrototypeOf(DecoratedConstructor, Target);

        return DecoratedConstructor;
    };
}

/**
 * 获取类的 HTTP 客户端配置
 *
 * @param target - 目标类
 * @returns HTTP 客户端配置（如果存在）
 */
export function getHttpClientConfig(target: object): HttpClientConfig | undefined {
    return Reflect.getMetadata(HTTP_CLIENT_CONFIG_KEY, target) as HttpClientConfig | undefined;
}
