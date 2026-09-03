import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const releaseCommit = process.argv[2] ?? 'HEAD';
const changedFiles = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', releaseCommit], {
    encoding: 'utf8',
})
    .split(/\r?\n/)
    .filter((file) => /^packages\/[^/]+\/package\.json$/.test(file));

let versionChangeCount = 0;

for (const file of changedFiles) {
    const currentManifest = JSON.parse(readFileSync(file, 'utf8'));
    let previousVersion;

    try {
        const previousManifest = JSON.parse(
            execFileSync('git', ['show', `${releaseCommit}^:${file}`], {
                encoding: 'utf8',
            })
        );
        previousVersion = previousManifest.version;
    } catch {
        previousVersion = undefined;
    }

    if (currentManifest.version === previousVersion) {
        continue;
    }

    versionChangeCount += 1;
    const tag = `${currentManifest.name}@${currentManifest.version}`;
    const tagExists = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]).status === 0;

    if (tagExists) {
        console.log(`Skip existing tag: ${tag}`);
        continue;
    }

    execFileSync('git', ['tag', '-a', tag, '-m', tag], { stdio: 'inherit' });
    console.log(`Created tag: ${tag}`);
}

if (versionChangeCount === 0) {
    console.error(`No package version changes found in ${releaseCommit}.`);
    process.exitCode = 1;
}
