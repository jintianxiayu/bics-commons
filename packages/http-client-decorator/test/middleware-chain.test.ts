import { executeMiddlewareChain } from '../src';
import type { HttpContext } from '../src';

describe('中间件链执行顺序', () => {
  it('should execute middlewares in order (onion model)', async () => {
    const log: string[] = [];

    const middlewareA = async (_ctx: HttpContext, next: () => Promise<void>) => {
      log.push('A:before');
      await next();
      log.push('A:after');
    };

    const middlewareB = async (_ctx: HttpContext, next: () => Promise<void>) => {
      log.push('B:before');
      await next();
      log.push('B:after');
    };

    const handler = async () => {
      log.push('handler');
    };

    await executeMiddlewareChain({} as HttpContext, [middlewareA, middlewareB], handler);

    expect(log).toEqual(['A:before', 'B:before', 'handler', 'B:after', 'A:after']);
  });

  it('should execute with empty middlewares', async () => {
    const log: string[] = [];
    const handler = async () => {
      log.push('handler');
    };

    await executeMiddlewareChain({} as HttpContext, [], handler);

    expect(log).toEqual(['handler']);
  });

  it('should pass context state between middlewares', async () => {
    const ctx: HttpContext = {
      request: { method: 'GET', url: '/test', headers: {} },
      state: {},
    };

    const middlewareA = async (c: HttpContext, next: () => Promise<void>) => {
      c.state.fromA = 'a';
      await next();
    };

    const middlewareB = async (c: HttpContext, next: () => Promise<void>) => {
      c.state.fromB = 'b';
      await next();
    };

    const handler = async () => {
      expect(ctx.state.fromA).toBe('a');
      expect(ctx.state.fromB).toBe('b');
    };

    await executeMiddlewareChain(ctx, [middlewareA, middlewareB], handler);
  });

  it('should allow middleware to short-circuit by not calling next', async () => {
    const log: string[] = [];

    const middlewareA = async (_ctx: HttpContext, _next: () => Promise<void>) => {
      log.push('A:before');
      // not calling next - short circuit
    };

    const middlewareB = async (_ctx: HttpContext, next: () => Promise<void>) => {
      log.push('B:before');
      await next();
      log.push('B:after');
    };

    const handler = async () => {
      log.push('handler');
    };

    await executeMiddlewareChain({} as HttpContext, [middlewareA, middlewareB], handler);

    expect(log).toEqual(['A:before']);
  });
});
