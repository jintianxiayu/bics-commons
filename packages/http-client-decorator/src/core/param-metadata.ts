/**
 * 参数类型定义
 */
export type ParamType = 'path' | 'query' | 'body' | 'header';

/**
 * 参数元数据接口
 *
 * 存储参数装饰器标记的方法参数信息
 *
 * @param paramIndex - 参数在函数签名中的索引位置
 * @param paramType - 参数类型（path/query/body/header）
 * @param paramName - 参数名称（用于 path、query、header 类型）
 */
export interface ParamMetadata {
    paramIndex: number;
    paramType: ParamType;
    paramName?: string;
}
