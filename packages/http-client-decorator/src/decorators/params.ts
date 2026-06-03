import 'reflect-metadata';
import type { ParamMetadata, ParamType } from '../core/param-metadata';

const PARAM_METADATA_KEY = Symbol.for('bics:http-client:param');

/**
 * 创建参数装饰器
 *
 * @param paramType - 参数类型
 * @param paramName - 参数名称（可选）
 * @returns 参数装饰器工厂函数
 */
function createParamDecorator(paramType: ParamType, paramName?: string) {
    return function (target: object, propertyKey: string | symbol, parameterIndex: number): void {
        const existing: ParamMetadata[] = Reflect.getMetadata(PARAM_METADATA_KEY, target, propertyKey) || [];

        const metadata: ParamMetadata = {
            paramIndex: parameterIndex,
            paramType,
            paramName,
        };

        existing.push(metadata);
        Reflect.defineMetadata(PARAM_METADATA_KEY, existing, target, propertyKey);
    };
}

/**
 * URL 路径参数装饰器
 *
 * @param paramName - 参数名称
 */
export const Path = (paramName: string) => createParamDecorator('path', paramName);
/**
 * URL 查询参数装饰器
 *
 * @param paramName - 参数名称
 */
export const Query = (paramName: string) => createParamDecorator('query', paramName);
/**
 * 请求体参数装饰器
 */
export const Body = () => createParamDecorator('body');
/**
 * 请求头参数装饰器
 *
 * @param paramName - 参数名称
 */
export const Header = (paramName: string) => createParamDecorator('header', paramName);

/**
 * 获取方法的参数元数据列表
 *
 * @param target - 目标对象
 * @param propertyKey - 方法属性名
 * @returns 参数元数据数组
 */
export function getParamMetadata(target: object, propertyKey: string | symbol): ParamMetadata[] {
    return (Reflect.getMetadata(PARAM_METADATA_KEY, target, propertyKey) as ParamMetadata[]) || [];
}
