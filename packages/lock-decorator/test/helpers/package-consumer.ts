import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const packageRoot = resolve(__dirname, '../..');

/** 从 README 指定小节提取第一个 TypeScript 示例，使文档参与真实消费项目编译。 */
export function readReadmeExample(section: string): string {
    const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8').replaceAll('\r\n', '\n');
    const heading = `### ${section}\n`;
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
    directory: string;
    installedPackage: string;
    dependencyTree: string;
}

/**
 * 用结构化参数运行子进程，避免 Windows shell 对路径和脚本的二次解释。
 * @param request 可执行文件、参数及工作目录。
 * @returns 标准输出。
 * @throws 子进程失败、超时或无法启动时抛出带输出的错误。
 */
export function runCommand(request: { executable: string; args: string[]; cwd: string }): string {
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

/** 创建与 workspace 不相交的临时测试根目录。 */
export function createPackageTestRoot(): string {
    return mkdtempSync(join(tmpdir(), 'lock-consumer-'));
}

/** 构建本包并打包当前文件，返回这次测试使用的 tarball。 */
export function packCurrentPackage(root: string): string {
    runCommand({
        executable: process.execPath,
        args: [require.resolve('typescript/bin/tsc'), '-p', join(packageRoot, 'tsconfig.json')],
        cwd: packageRoot,
    });
    const archive = join(root, 'lock-decorator.tgz');
    runPnpm(['pack', '--out', archive, '--json'], packageRoot);
    return archive;
}

/** 读取实际安装版本，消费项目不通过范围解析无关的新版本。 */
function installedVersion(name: string): string {
    const localManifest = join(packageRoot, 'node_modules', name, 'package.json');
    const manifestPath = existsSync(localManifest) ? localManifest : require.resolve(`${name}/package.json`);
    const manifest: { version: string } = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest.version;
}

/**
 * 安装真实 tarball 和唯一指定的 Redis 客户端，编译并运行消费用法。
 * @param request 临时根、归档、客户端名称及消费源码。
 * @returns 可审计的安装路径及生产依赖树。
 * @throws 安装、严格类型检查或运行失败时抛出。
 */
export function installConsumer(request: {
    root: string;
    archive: string;
    client: 'none' | 'redis' | 'ioredis';
    source: string;
    readmeSource: string;
}): PackageConsumer {
    const directory = join(request.root, request.client);
    mkdirSync(directory);
    const dependencies: Record<string, string> = {
        '@jintianxiayu/lock-decorator': `file:${request.archive.replaceAll('\\', '/')}`,
    };
    if (request.client !== 'none') {
        dependencies[request.client] = installedVersion(request.client);
        dependencies['reflect-metadata'] = installedVersion('reflect-metadata');
    }
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
            name: `lock-consumer-${request.client}`,
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
            include: ['consumer.ts', 'readme-example.ts'],
        })
    );
    writeFileSync(join(directory, 'consumer.ts'), request.source);
    writeFileSync(join(directory, 'readme-example.ts'), request.readmeSource);
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
        installedPackage: join(directory, 'node_modules/@jintianxiayu/lock-decorator'),
        dependencyTree: runPnpm(['list', '--prod', '--depth', '100', '--json'], directory),
    };
}

/** 仅删除本测试通过 mkdtemp 创建且已确认位于系统临时目录内的目录。 */
export function removePackageTestRoot(root: string): void {
    const absolute = resolve(root);
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('lock-consumer-')) {
        throw new Error('Refusing to remove a path outside the package test temporary root');
    }
    rmSync(absolute, { recursive: true, force: true, maxRetries: 3 });
}
