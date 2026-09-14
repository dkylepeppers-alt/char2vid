import { spawnSync } from 'node:child_process';

export function requireNewReleaseTag(repository, tag) {
  const result = spawnSync(
    'gh',
    [
      'api',
      `repos/${repository}/git/matching-refs/tags/${tag}`,
      '--jq',
      `[.[] | select(.ref == "refs/tags/${tag}")] | length`,
    ],
    { encoding: 'utf8' },
  );

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`Could not verify release tag ${tag}.`);
  }

  const matchCount = Number(result.stdout.trim());
  if (!Number.isSafeInteger(matchCount) || matchCount < 0) {
    throw new Error(`Could not verify release tag ${tag}.`);
  }
  if (matchCount !== 0) {
    throw new Error(`Release tag ${tag} already exists.`);
  }
}

const [repository, tag] = process.argv.slice(2);
if (repository === undefined || tag === undefined) {
  throw new Error('Use require-new-release-tag <owner/repository> <tag>.');
}
requireNewReleaseTag(repository, tag);
