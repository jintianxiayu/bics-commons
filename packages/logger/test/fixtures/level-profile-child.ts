import { LoggerFactory } from '../../src';

// 环境由父进程在启动时提供，首次获取覆盖延迟初始化路径。
const orders = LoggerFactory.getLogger('orders');
orders.debug('debug event', { token: 'secret' });
orders.info('info event', { token: 'secret' });
LoggerFactory.getLogger('other').debug('filtered other');
LoggerFactory.shutdown().catch((error: unknown) => {
    process.stderr.write(String(error));
    process.exitCode = 1;
});
