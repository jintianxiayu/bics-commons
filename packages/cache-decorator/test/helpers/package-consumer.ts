import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const packageRoot = resolve(__dirname, '../..');

/**
 * 从 README 指定小节提取第一个 TypeScript 示例，使文档参与真实消费项目编译。
 * @param section README 的三级标题文本。
 * @param headingLevel 小节使用的二级或三级标题层级。
 * @returns 标题下第一个 TypeScript 代码块。
 * @throws 标题或代码块不存在时抛出。
 */
export function readReadmeExample(section: string, headingLevel: 2 | 3 = 3): string {
    const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8').replaceAll('\r\n', '\n');
    const heading = `${'#'.repeat(headingLevel)} ${section}\n`;
    const sectionStart = readme.indexOf(heading);
    if (sectionStart < 0) {
        throw new Error(`Missing README section: ${section}`);
    }
    const sectionEnd = readme.indexOf('\n##', sectionStart + heading.length);
    const content = readme.slice(sectionStart, sectionEnd < 0 ? undefined : sectionEnd);
    const example = /```typescript\n([\s\S]*?)\n```/.exec(content)?.[1];
    if (!example) {
        throw new Error(`Missing TypeScript example in README section: ${section}`);
    }
    return example;
}

/** 临时消费项目的已安装产物；所有路径均位于当前测试拥有的临时目录。 */
export interface PackageConsumer {
    readonly directory: string;
    readonly installedPackage: string;
    readonly dependencyTree: string;
}

/**
 * 用结构化参数运行子进程，并清除可能让临时项目继承 workspace 依赖的环境变量。
 * @param request 可执行文件、参数及工作目录。
 * @returns 标准输出。
 * @throws 子进程失败、超时或无法启动时抛出带输出的错误。
 */
export function runCommand(request: {
    readonly executable: string;
    readonly args: string[];
    readonly cwd: string;
}): string {
    const environment = { ...process.env };
    delete environment.NODE_PATH;
    delete environment.INIT_CWD;
    delete environment.PNPM_WORKSPACE_DIR;
    const result = spawnSync(request.executable, request.args, {
        cwd: request.cwd,
        env: environment,
        encoding: 'utf8',
        timeout: 120000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        throw new Error(
            `${request.executable} failed: ${result.error?.message ?? result.status}\n${result.stdout}\n${result.stderr}`
        );
    }
    return result.stdout;
}

/** 使用生命周期提供的 pnpm 路径；Windows 独立 Jest 运行兼容 Node 安装目录中的 pnpm。 */
function runPnpm(args: string[], cwd: string): string {
    const candidates = [
        process.env.npm_execpath,
        join(dirname(process.execPath), 'node_modules/pnpm/bin/pnpm.mjs'),
        join(dirname(process.execPath), 'node_modules/pnpm/bin/pnpm.cjs'),
    ];
    const executable = candidates.find((candidate) => candidate && existsSync(candidate));
    if (!executable) {
        throw new Error('Run package consumer tests with pnpm test');
    }
    const isScript = ['.mjs', '.cjs', '.js'].some((extension) => executable.endsWith(extension));
    return runCommand({
        executable: isScript ? process.execPath : executable,
        args: isScript ? [executable, ...args] : args,
        cwd,
    });
}

/**
 * 创建与 workspace 不相交的临时测试根目录。
 * @returns 位于系统临时目录且带专用前缀的目录。
 */
export function createPackageTestRoot(): string {
    return mkdtempSync(join(tmpdir(), 'cache-consumer-'));
}

/**
 * 构建并打包当前 cache-decorator 包。
 * @param root 本次测试拥有的临时根目录。
 * @returns 这次测试使用的 tarball 绝对路径。
 * @throws 构建或打包失败时抛出。
 */
export function packCurrentPackage(root: string): string {
    runCommand({
        executable: process.execPath,
        args: [require.resolve('typescript/bin/tsc'), '-p', join(packageRoot, 'tsconfig.json')],
        cwd: packageRoot,
    });
    const archive = join(root, 'cache-decorator.tgz');
    runPnpm(['pack', '--out', archive, '--json'], packageRoot);
    return archive;
}

/**
 * 构建并打包当前 workspace Logger，供外部消费 fixture 显式满足 required peer。
 * @param root 本次测试拥有的临时根目录。
 * @returns 这次测试使用的 Logger tarball 绝对路径。
 * @throws 构建或打包失败时抛出。
 */
export function packLoggerPackage(root: string): string {
    const loggerRoot = resolve(packageRoot, '../logger');
    runCommand({
        executable: process.execPath,
        args: [require.resolve('typescript/bin/tsc'), '-p', join(loggerRoot, 'tsconfig.json')],
        cwd: loggerRoot,
    });
    const archive = join(root, 'logger.tgz');
    runPnpm(['pack', '--out', archive, '--json'], loggerRoot);
    return archive;
}

/** 读取当前 workspace 已安装版本，避免消费测试解析无关的新版本。 */
function installedVersion(name: string): string {
    const localManifest = join(packageRoot, 'node_modules', name, 'package.json');
    const manifestPath = existsSync(localManifest) ? localManifest : require.resolve(`${name}/package.json`);
    const manifest: { readonly version: string } = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest.version;
}

/**
 * 安装真实 tarball 和唯一指定的 Redis 客户端，严格编译并运行消费用法。
 * @param request 临时根、归档、客户端名称及消费源码。
 * @returns 可审计的安装路径及生产依赖树。
 * @throws 安装、严格类型检查或运行失败时抛出。
 */
export function installConsumer(request: {
    readonly root: string;
    readonly archive: string;
    readonly loggerArchive: string;
    readonly client: 'none' | 'redis' | 'ioredis';
    readonly source: string;
    readonly readmeSource: string;
    readonly quickStartSource: string;
}): PackageConsumer {
    const directory = join(request.root, request.client);
    mkdirSync(directory);
    const dependencies: Record<string, string> = {
        '@jintianxiayu/cache-decorator': `file:${request.archive.replaceAll('\\', '/')}`,
        '@jintianxiayu/logger': `file:${request.loggerArchive.replaceAll('\\', '/')}`,
        'reflect-metadata': installedVersion('reflect-metadata'),
    };
    if (request.client !== 'none') {
        dependencies[request.client] = installedVersion(request.client);
    }
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
            name: `cache-consumer-${request.client}`,
            private: true,
            dependencies,
            devDependencies: {
                typescript: installedVersion('typescript'),
                '@types/node': installedVersion('@types/node'),
            },
        })
    );
    writeFileSync(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                skipLibCheck: false,
                target: 'ES2021',
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                types: ['node'],
                outDir: 'out',
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
            },
            include: ['consumer.ts', 'readme-example.ts', 'quick-start.ts'],
        })
    );
    writeFileSync(join(directory, 'consumer.ts'), request.source);
    writeFileSync(join(directory, 'readme-example.ts'), request.readmeSource);
    writeFileSync(join(directory, 'quick-start.ts'), request.quickStartSource);
    runPnpm(
        [
            'install',
            '--ignore-scripts',
            '--store-dir',
            join(request.root, 'store'),
            '--config.auto-install-peers=false',
        ],
        directory
    );
    runCommand({
        executable: process.execPath,
        args: [join(directory, 'node_modules/typescript/bin/tsc'), '-p', directory],
        cwd: directory,
    });
    runCommand({ executable: process.execPath, args: [join(directory, 'out/consumer.js')], cwd: directory });
    return {
        directory,
        installedPackage: join(directory, 'node_modules/@jintianxiayu/cache-decorator'),
        dependencyTree: runPnpm(['list', '--prod', '--depth', '100', '--json'], directory),
    };
}

/**
 * 仅删除本测试通过 mkdtemp 创建且已确认位于系统临时目录内的目录。
 * @param root 待删除的测试临时根目录。
 * @returns 删除完成后返回。
 * @throws 目标不在系统临时目录或前缀不匹配时拒绝删除。
 */
export function removePackageTestRoot(root: string): void {
    const absolute = resolve(root);
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('cache-consumer-')) {
        throw new Error('Refusing to remove a path outside the package test temporary root');
    }
    rmSync(absolute, { recursive: true, force: true, maxRetries: 3 });
}
