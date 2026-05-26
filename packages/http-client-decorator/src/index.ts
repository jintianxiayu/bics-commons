/**
 * @bics/http-client-decorator - 基于装饰器的 HTTP 客户端框架
 *
 * 提供 RPC-like 调用体验的 HTTP 客户端框架，支持：
 * - 装饰器声明式 HTTP 方法定义
 * - Koa 风格洋葱模型中间件
 * - 自动错误处理
 */

// 类装饰器
export { HttpClient, getHttpClientConfig } from './decorators/http-client';

// 方法装饰器
export {
  Get,
  Post,
  Put,
  Delete,
  Patch,
  getMethodMetadata,
} from './decorators/http-methods';

// 参数装饰器
export {
  Path,
  Query,
  Body,
  Header,
  getParamMetadata,
} from './decorators/params';

// 类型定义
export type { HttpClientConfig } from './core/http-client-config';
export type { HttpContext } from './core/middleware';
export type { Middleware } from './core/middleware';
export type { MethodMetadata, HttpMethod } from './core/method-metadata';
export type { ParamMetadata, ParamType } from './core/param-metadata';

// 错误类
export { HttpError } from './core/http-error';

// 中间件链
export { executeMiddlewareChain } from './core/middleware';