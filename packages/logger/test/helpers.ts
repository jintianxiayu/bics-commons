import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 测试隔离文件输出目录，避免并发用例互相读取或清理对方的日志。
 *
 * @param prefix 临时目录名称前缀。
 * @returns 新创建的唯一临时目录路径。
 * @throws 当操作系统无法创建临时目录时透传文件系统异常。
 */
export function createTempDirectory(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * 测试结束后清理独立目录，避免临时日志影响后续用例和本地工作区。
 *
 * @param directory 需要递归清理的测试临时目录。
 * @returns 无返回值。
 * @throws 不主动抛出异常；清理使用 force 语义忽略不存在的目标。
 */
export function removeTempDirectory(directory: string): void {
    rmSync(directory, { recursive: true, force: true });
}

/**
 * 集成测试通过真实 YAML 文件覆盖配置加载路径，以验证部署时的文件读取行为。
 *
 * @param directory 保存配置文件的测试临时目录。
 * @param source 需要写入的 YAML 配置文本。
 * @returns 已写入配置文件的绝对路径。
 * @throws 当文件系统无法写入配置文件时透传异常。
 */
export function writeConfig(directory: string, source: string): string {
    const configPath = join(directory, 'logger.yaml');
    writeFileSync(configPath, source, 'utf8');
    return configPath;
}

/**
 * 单元测试默认关闭输出通道，使断言聚焦日志逻辑且不污染测试进程的标准流。
 *
 * @param extra 需要附加到基础 YAML 后的测试配置片段。
 * @returns 禁用输出和进程错误处理的 YAML 配置文本。
 * @throws 不主动抛出异常。
 */
export function disabledOutputConfig(extra = ''): string {
    return `
root:
  console:
    enabled: false
  file:
    enabled: false
processErrors:
  uncaughtException: false
  unhandledRejection: false
  exitOnError: false
${extra}`;
}
