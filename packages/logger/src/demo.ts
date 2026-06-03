/**
 * @jintianxiayu/logger 使用示例
 *
 * 运行方式：
 * 1. 直接运行: npx ts-node examples/demo.ts
 * 2. 或编译后运行: npm run build && node dist/examples/demo.js
 */

import { LoggerFactory, LoggerContext } from './';

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
        cardNumber: '5555555555554444', // 会自动掩码
        cvv: '123', // 会自动掩码
    });
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

    // 设置超时强制退出
    await LoggerFactory.shutdown({ timeout: 3000 });
    console.log('Logger 已关闭');
}

// 主函数
async function main() {
    try {
        basicUsage();
        traceIdUsage();
        sensitiveDataUsage();
        multiLoggerUsage();
        await gracefulShutdown();
    } catch (error) {
        console.error('示例执行失败:', error);
    }
}

main();
