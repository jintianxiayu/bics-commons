/**
 * HTTP 方法类型定义
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * HTTP 方法元数据接口
 *
 * 存储方法装饰器标记的 HTTP 方法信息
 *
 * @param method - HTTP 方法类型
 * @param path - 请求路径
 */
export interface MethodMetadata {
    method: HttpMethod;
    path: string;
}
