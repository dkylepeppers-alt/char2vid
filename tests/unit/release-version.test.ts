import { describe, expect, it } from 'vitest';

import {
  assertMonotonicVersionCode,
  greatestReleasedVersionCode,
  releaseMetadata,
  releaseNotes,
} from '../../scripts/release-version.mjs';

const publishedRelease = (versionCode: number) => ({
  draft: false,
  body: `Release notes.\n\n<!-- char2vid-android-release: {"versionCode":${versionCode},"versionName":"0.1.0"} -->`,
});

describe('Android release versioning', () => {
  it('finds the greatest code recorded by published or draft releases', () => {
    expect(
      greatestReleasedVersionCode([
        publishedRelease(7),
        { ...publishedRelease(99), draft: true },
        publishedRelease(12),
      ]),
    ).toBe(99);
  });

  it('rejects a reused or lower code', () => {
    expect(() => assertMonotonicVersionCode(12, 12)).toThrow(
      'must be greater than previously released versionCode 12',
    );
    expect(() => assertMonotonicVersionCode(11, 12)).toThrow(
      'must be greater than previously released versionCode 12',
    );
  });

  it('records machine-readable and reviewer-visible metadata', () => {
    expect(releaseMetadata('v2.3.4', 42)).toEqual({
      versionName: '2.3.4',
      versionCode: 42,
    });
    expect(
      greatestReleasedVersionCode([
        { draft: true, body: releaseNotes('v2.3.4', 42) },
      ]),
    ).toBe(42);
  });
});
