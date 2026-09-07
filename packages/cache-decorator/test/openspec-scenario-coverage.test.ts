import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

interface ScenarioMapping {
    readonly marker: string;
    readonly occurrences: number;
}

const repositoryRoot = resolve(__dirname, '../../..');
const changeRoot = join(repositoryRoot, 'openspec/changes/decouple-redis-cache-client');
const specFiles = [
    join(changeRoot, 'specs/redis-cache-client/spec.md'),
    join(changeRoot, 'specs/cache-evict-allentries-prefix/spec.md'),
];

/** 从 delta spec 提取带 capability 前缀的逐字 Scenario 标记。 */
function readScenarioMarkers(): string[] {
    const markers: string[] = [];
    for (const specFile of specFiles) {
        const capability = basename(dirname(specFile));
        const source = readFileSync(specFile, 'utf8');
        for (const match of source.matchAll(/^#### Scenario: (.+)$/gm)) {
            const title = match[1]?.trim();
            if (!title) {
                throw new Error(`Invalid Scenario heading in ${specFile}`);
            }
            markers.push(`${capability}/${title}`);
        }
    }
    return markers;
}

/** 统计每个 Scenario 标记在自动化测试名中的出现次数，不让本审计文件自匹配。 */
function mapScenarios(markers: readonly string[]): ScenarioMapping[] {
    const sources = readdirSync(__dirname, { recursive: true })
        .map(String)
        .filter((entry) => entry.endsWith('.test.ts') && basename(entry) !== basename(__filename))
        .map((entry) => readFileSync(join(__dirname, entry), 'utf8'));
    return markers.map((marker) => {
        const separator = marker.indexOf('/');
        const capability = marker.slice(0, separator);
        const title = marker.slice(separator + 1);
        const scenarioId = /^([A-Z]\d{2})\s/.exec(title)?.[1];
        const testMarker = scenarioId ? `${capability}/${scenarioId}` : marker;
        return {
            marker,
            occurrences: sources.reduce((count, source) => count + source.split(testMarker).length - 1, 0),
        };
    });
}

const mappings = mapScenarios(readScenarioMarkers());

it('OpenSpec Scenario 审计提取 49 个场景且无自动化遗漏', () => {
    expect(mappings).toHaveLength(49);
    expect(mappings.filter(({ occurrences }) => occurrences === 0)).toEqual([]);
});

it('OpenSpec Scenario 审计显式记录重复映射', () => {
    expect(mappings.filter(({ occurrences }) => occurrences > 1)).toEqual([
        { marker: 'redis-cache-client/V06 缺省 TTL 与零 TTL 永不过期', occurrences: 2 },
        { marker: 'redis-cache-client/A05 GET 响应规范化', occurrences: 2 },
        { marker: 'redis-cache-client/A06 删除和清库响应规范化', occurrences: 2 },
        { marker: 'redis-cache-client/A07 调用上下文与请求保持不变', occurrences: 2 },
        { marker: 'redis-cache-client/A08 非标准响应明确失败', occurrences: 2 },
        { marker: 'redis-cache-client/P02 仅安装 node-redis 的消费项目', occurrences: 2 },
        { marker: 'redis-cache-client/P03 仅安装 ioredis 的消费项目', occurrences: 2 },
        {
            marker: 'cache-evict-allentries-prefix/RedisCacheProvider 使用 SCAN 迭代删除',
            occurrences: 2,
        },
        {
            marker: 'cache-evict-allentries-prefix/F05 ioredis keyPrefix 下删除逻辑 pattern',
            occurrences: 2,
        },
        {
            marker: 'cache-evict-allentries-prefix/F07 node-redis 缺省前缀不改写 key',
            occurrences: 2,
        },
        {
            marker: 'cache-evict-allentries-prefix/F08 node-redis 显式前缀访问同一命名空间',
            occurrences: 2,
        },
    ]);
});
