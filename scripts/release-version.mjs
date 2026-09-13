import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const metadataPattern = /<!-- char2vid-android-release: (\{[^\n]+\}) -->/g;

function releasedEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
}

export function greatestReleasedVersionCode(releases) {
  let greatest = 0;
  for (const release of releasedEntries(releases)) {
    if (typeof release?.body !== 'string') continue;
    for (const match of release.body.matchAll(metadataPattern)) {
      const metadata = JSON.parse(match[1]);
      if (
        Number.isSafeInteger(metadata.versionCode) &&
        metadata.versionCode > 0 &&
        typeof metadata.versionName === 'string'
      ) {
        greatest = Math.max(greatest, metadata.versionCode);
      }
    }
  }
  return greatest;
}

export function assertMonotonicVersionCode(versionCode, previous) {
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > 2_100_000_000
  ) {
    throw new Error(
      'versionCode must be an integer from 1 through 2100000000.',
    );
  }
  if (versionCode <= previous) {
    throw new Error(
      `versionCode ${versionCode} must be greater than previously released versionCode ${previous}.`,
    );
  }
}

export function releaseMetadata(tag, versionCode) {
  const match = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag);
  if (match === null)
    throw new Error('Release tag must use vMAJOR.MINOR.PATCH.');
  assertMonotonicVersionCode(versionCode, 0);
  return { versionName: match[1], versionCode };
}

export function releaseNotes(tag, versionCode) {
  const metadata = releaseMetadata(tag, versionCode);
  return `Android studio build.\n\n- Android versionName: ${metadata.versionName}\n- Android versionCode: ${metadata.versionCode}\n\n<!-- char2vid-android-release: ${JSON.stringify(metadata)} -->`;
}

function run() {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'validate' && first !== undefined && second !== undefined) {
    const current = Number(first);
    const previous = greatestReleasedVersionCode(
      JSON.parse(readFileSync(second, 'utf8')),
    );
    assertMonotonicVersionCode(current, previous);
    console.log(
      `Validated versionCode ${current}; greatest recorded code is ${previous}.`,
    );
    return;
  }
  if (command === 'metadata' && first !== undefined && second !== undefined) {
    console.log(JSON.stringify(releaseMetadata(first, Number(second))));
    return;
  }
  if (command === 'notes' && first !== undefined && second !== undefined) {
    console.log(releaseNotes(first, Number(second)));
    return;
  }
  throw new Error(
    'Use validate <versionCode> <releases.json>, metadata <tag> <versionCode>, or notes <tag> <versionCode>.',
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  run();
}
