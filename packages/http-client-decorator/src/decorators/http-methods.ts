import 'reflect-metadata';
import type { HttpMethod, MethodMetadata } from '../core/method-metadata';

const METHOD_METADATA_KEY = Symbol.for('bics:http-client:method');

/**
 * 创建 HTTP 方法装饰器
 *
 * @param method - HTTP 方法类型
 * @returns 方法装饰器工厂函数
 */
function createMethodDecorator(method: HttpMethod) {
    return function (path: string) {
        return function (
            target: object,
            propertyKey: string | symbol,

            _descriptor: PropertyDescriptor
        ): void {
            const metadata: MethodMetadata = { method, path };
            Reflect.defineMetadata(METHOD_METADATA_KEY, metadata, target, propertyKey);
        };
    };
}

/**
 * GET 请求装饰器
 */
export const Get = createMethodDecorator('GET');
/**
 * POST 请求装饰器
 */
export const Post = createMethodDecorator('POST');
/**
 * PUT 请求装饰器
 */
export const Put = createMethodDecorator('PUT');
/**
 * DELETE 请求装饰器
 */
export const Delete = createMethodDecorator('DELETE');
/**
 * PATCH 请求装饰器
 */
export const Patch = createMethodDecorator('PATCH');

/**
 * 获取方法的 HTTP 元数据
 *
 * @param target - 目标对象
 * @param propertyKey - 方法属性名
 * @returns 方法元数据（如果存在）
 */
export function getMethodMetadata(target: object, propertyKey: string | symbol): MethodMetadata | undefined {
    return Reflect.getMetadata(METHOD_METADATA_KEY, target, propertyKey) as MethodMetadata | undefined;
}
