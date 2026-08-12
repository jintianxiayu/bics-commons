/**
 * @jintianxiayu/logger 使用示例
 *
 * 运行方式：
 * 1. 直接运行: npx ts-node examples/demo.ts
 * 2. 或编译后运行: npm run build && node dist/examples/demo.js
 */

import { LoggerFactory, LoggerContext } from '../src';

/**
 * 示例：基本日志记录
 */
function basicUsage() {
    console.log('\n========== 基本用法 ==========\n');

    const logger = LoggerFactory.getLogger('app');

    logger.debug('这是一条调试信息');
    logger.info('应用启动', { version: '1.0.0', env: 'production' });
    logger.warn('内存使用率较高', { usage: '85%' });
    logger.error('连接失败', { host: 'db.example.com', port: 5432 });

    // 默认 plain pattern 包含 %{log_position}，输出 relative/path.ts:line:column。
    // 下游采集规则升级期间应同时接受旧 path:line 与新 path:line:column。
}

/**
 * 示例：traceId 追踪功能
 */
function traceIdUsage() {
    console.log('\n========== traceId 追踪 ==========\n');

    const logger = LoggerFactory.getLogger('trace-demo');

    // 方式1：使用 withContext 自动传递 traceId
    LoggerContext.withContext({ traceId: 'req-001-abc' }, () => {
        logger.info('处理 HTTP 请求');
        // 后续的日志会自动带上 traceId
        logger.info('业务处理中', { orderId: 'ord_123' });
    });

    // 方式2：手动设置 traceId
    LoggerContext.set('traceId', 'req-002-xyz');
    logger.info('另一个请求');

    // 清除 traceId
    LoggerContext.clear();
    logger.info('请求结束');
}

/**
 * 示例：带敏感信息掩码的日志
 */
function sensitiveDataUsage() {
    console.log('\n========== 敏感信息掩码 ==========\n');

    // LoggerFactory 会自动对 meta 中的敏感字段进行掩码
    const logger = LoggerFactory.getLogger('security');

    logger.info('用户登录成功', {
        userId: 'u12345',
        email: 'user@example.com',
        password: 'secret123', // 会自动掩码
        creditCard: '4111111111111111', // 会自动掩码
        ip: '192.168.1.1',
    });

    logger.warn('支付失败', {
        orderId: 'ord_789',
        cardNo: '5555555555554444', // 默认规则会自动掩码
        status: 'declined',
    });
}

/**
 * 示例：特殊 meta 值的安全序列化
 */
function safeMetaUsage() {
    console.log('\n========== Meta 安全序列化 ==========\n');

    const logger = LoggerFactory.getLogger('safe-meta');
    const cause = new Error('上游请求失败');
    const error = new Error('任务执行失败');
    Object.defineProperty(error, 'cause', { value: cause });
    const meta: Record<string, unknown> = {
        requestId: 9007199254740993n,
        occurredAt: new Date('2026-08-13T01:02:03.000Z'),
        error,
        token: 'raw-token', // 特殊值遍历前仍会优先脱敏
    };
    meta.self = meta; // 输出 [Circular]，不会抛出异常

    logger.error('安全记录特殊 meta', meta);
}

/**
 * 示例：多 Logger 命名空间
 */
function multiLoggerUsage() {
    console.log('\n========== 多 Logger 命名空间 ==========\n');

    const dbLogger = LoggerFactory.getLogger('database');
    const httpLogger = LoggerFactory.getLogger('http');
    const bizLogger = LoggerFactory.getLogger('business');

    dbLogger.info('数据库连接已建立', { host: 'localhost', database: 'mydb' });
    httpLogger.info('收到 HTTP 请求', { method: 'GET', path: '/api/users' });
    bizLogger.info('业务处理完成', { orderId: 'ord_001', amount: 199.99 });
}

/**
 * 示例：优雅关闭
 */
async function gracefulShutdown() {
    console.log('\n========== 优雅关闭 ==========\n');

    const logger = LoggerFactory.getLogger('shutdown-demo');
    logger.info('执行优雅关闭...');

    // 同一轮并发调用会共享关闭过程；关闭后如需继续使用，应重新获取 logger
    await LoggerFactory.shutdown({ timeout: 3000 });
    console.log('Logger 已关闭');
}

// 主函数
async function main() {
    try {
        basicUsage();
        traceIdUsage();
        sensitiveDataUsage();
        safeMetaUsage();
        multiLoggerUsage();
        await gracefulShutdown();
    } catch (error) {
        console.error('示例执行失败:', error);
    }
}

main();
