import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { normalizeCatalog } from '../../packages/nanogpt/src/catalog/normalize';
import {
  auditCatalogCoverage,
  renderCoverageMarkdown,
} from '../../packages/nanogpt/src/catalog/coverage';
import { ROUTE_CONTRACTS } from '../../packages/nanogpt/src/contracts/route-contract';

interface Fixture {
  body: unknown;
}

const fixtureFile = JSON.parse(
  readFileSync(
    new URL('../fixtures/nanogpt/catalogs.json', import.meta.url),
    'utf8',
  ),
) as { fixtures: Record<string, Fixture> };

function modelsFrom(
  catalog: 'text' | 'image' | 'video' | 'audio',
  name: string,
) {
  return normalizeCatalog(
    catalog,
    fixtureFile.fixtures[name]?.body,
    '2026-09-15T00:00:00Z',
  ).models;
}

describe('auditCatalogCoverage (P5)', () => {
  it('lists each exact catalog ID once and does not treat flags as usable proof', () => {
    const models = [
      ...modelsFrom('image', 'imageMixed'),
      ...modelsFrom('video', 'videoNested'),
      ...modelsFrom('audio', 'audioMixed'),
      ...modelsFrom('text', 'textMinimal'),
      ...normalizeCatalog(
        'image',
        {
          data: [
            {
              id: 'vendor/text-only',
              name: 'Text Only',
              capabilities: { chat: true },
            },
          ],
        },
        '2026-09-15T00:00:00Z',
      ).models,
    ];
    const report = auditCatalogCoverage(models, ROUTE_CONTRACTS);
    const ids = report.rows.map((row) => `${row.catalog}:${row.modelId}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(report.total).toBe(report.rows.length);

    const byId = Object.fromEntries(
      report.rows.map((row) => [row.modelId, row]),
    );

    expect(byId['birefnet/v2']?.status).toBe('restricted');
    expect(byId['birefnet/v2']?.reason).toMatch(/input-reference limit/i);

    expect(byId['elevenlabs/music']?.status).toBe('unresolved');
    expect(byId['elevenlabs/music']?.reason).toMatch(/Missing operation/i);

    expect(byId['vendor/text-only']?.status).toBe('incompatible');

    expect(byId['xai-tts']?.status).toBe('usable');
    expect(byId['fixture/text-a']?.status).toBe('usable');
    expect(byId['bytedance/seedream-v5.0-pro']?.status).toBe('usable');

    expect(
      report.usable +
        report.restricted +
        report.unresolved +
        report.incompatible,
    ).toBe(report.total);

    const markdown = renderCoverageMarkdown(report);
    expect(markdown).toContain('birefnet/v2');
    expect(markdown).toContain('UNVERIFIED');
    expect(markdown).not.toContain('sk-');
  });

  it('is reporting-only and keeps duplicate IDs in different catalogs', () => {
    const shared = {
      id: 'shared/model',
      name: 'Shared',
      capabilities: { image_generation: true, video_generation: true },
    };
    const models = [
      ...normalizeCatalog('image', { data: [shared] }, '2026-09-15T00:00:00Z')
        .models,
      ...normalizeCatalog('video', { data: [shared] }, '2026-09-15T00:00:00Z')
        .models,
      ...normalizeCatalog('image', { data: [shared] }, '2026-09-15T00:00:00Z')
        .models,
    ];
    const report = auditCatalogCoverage(models, ROUTE_CONTRACTS);
    expect(
      report.rows.filter((row) => row.modelId === 'shared/model'),
    ).toHaveLength(2);
  });
});
