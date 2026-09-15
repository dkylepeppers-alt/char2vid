import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLIC_CATALOG_URLS,
  type GenerationCatalog,
} from '../packages/nanogpt/src/catalog/catalog-schema.ts';
import {
  auditCatalogCoverage,
  renderCoverageMarkdown,
} from '../packages/nanogpt/src/catalog/coverage.ts';
import { normalizeCatalog } from '../packages/nanogpt/src/catalog/normalize.ts';
import { ROUTE_CONTRACTS } from '../packages/nanogpt/src/contracts/route-contract.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const live = process.argv.includes('--live');
const fetchedAt = new Date().toISOString();

interface FixtureFile {
  fixtures: Record<string, { body: unknown }>;
}

const fixtures = JSON.parse(
  readFileSync(join(root, 'tests/fixtures/nanogpt/catalogs.json'), 'utf8'),
) as FixtureFile;

const fixtureCatalogs: Array<{
  catalog: GenerationCatalog;
  name: string;
}> = [
  { catalog: 'image', name: 'imageMixed' },
  { catalog: 'video', name: 'videoNested' },
  { catalog: 'audio', name: 'audioMixed' },
  { catalog: 'text', name: 'textMinimal' },
];

async function loadLiveModels() {
  const models = [];
  for (const catalog of Object.keys(
    PUBLIC_CATALOG_URLS,
  ) as GenerationCatalog[]) {
    const url = PUBLIC_CATALOG_URLS[catalog];
    const response = await fetch(url);
    const body: unknown = await response.json();
    models.push(...normalizeCatalog(catalog, body, fetchedAt).models);
  }
  return models;
}

function loadFixtureModels() {
  return fixtureCatalogs.flatMap(({ catalog, name }) => {
    const fixture = fixtures.fixtures[name];
    if (!fixture) {
      throw new Error(`missing fixture ${name}`);
    }
    return normalizeCatalog(catalog, fixture.body, fetchedAt).models;
  });
}

const models = live ? await loadLiveModels() : loadFixtureModels();
const report = auditCatalogCoverage(models, ROUTE_CONTRACTS);
const markdown = renderCoverageMarkdown(report);
const out = join(root, 'docs/validation/model-coverage.md');
writeFileSync(out, markdown);
process.stdout.write(
  `${live ? 'live' : 'fixtures'} audit wrote ${out} (${report.total} ids, usable=${report.usable}, restricted=${report.restricted}, unresolved=${report.unresolved}, incompatible=${report.incompatible})\n`,
);
