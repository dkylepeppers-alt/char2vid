import type { Operation } from '@char2vid/domain';

import type {
  GenerationCatalog,
  NanoGptModelDescriptor,
} from './catalog-schema.ts';
import type { RouteContract } from '../contracts/route-contract.ts';

export type CoverageStatus =
  'usable' | 'incompatible' | 'restricted' | 'unresolved';

export interface CoverageRow {
  catalog: GenerationCatalog;
  modelId: string;
  status: CoverageStatus;
  operations: Operation[];
  reason: string;
  evidence: string;
}

export interface CoverageReport {
  total: number;
  usable: number;
  incompatible: number;
  restricted: number;
  unresolved: number;
  rows: CoverageRow[];
}

const GENERATE_OPS: ReadonlySet<Operation> = new Set([
  'text',
  'image-generate',
  'video-generate',
  'speech',
  'transcribe',
]);

const INPUT_HEAVY_OPS: ReadonlySet<Operation> = new Set([
  'image-edit',
  'image-utility',
  'video-edit',
  'video-extend',
  'video-utility',
  'music',
  'sound-effect',
  'voice-clone',
]);

function contractsFor(
  operation: Operation,
  contracts: readonly RouteContract[],
): RouteContract[] {
  return contracts.filter((contract) => contract.operation === operation);
}

function classifyModel(
  model: NanoGptModelDescriptor,
  contracts: readonly RouteContract[],
): CoverageRow {
  const operations = model.operations;
  const base = {
    catalog: model.catalog,
    modelId: model.id,
    operations,
  };

  if (operations.length === 0) {
    return {
      ...base,
      status: 'incompatible',
      reason:
        'No generation operation mapped from catalog flags; broad capability bits were not treated as a usable route.',
      evidence: 'packages/nanogpt/src/catalog/normalize.ts#inferOperations',
    };
  }

  const missingOps = operations.filter(
    (operation) => contractsFor(operation, contracts).length === 0,
  );
  const generateOps = operations.filter((operation) =>
    GENERATE_OPS.has(operation),
  );
  const generateContracts = generateOps.flatMap((operation) =>
    contractsFor(operation, contracts),
  );

  if (generateOps.length === 0 && missingOps.length === operations.length) {
    return {
      ...base,
      status: 'unresolved',
      reason: `Missing operation contract: ${missingOps.join(', ')}.`,
      evidence: 'packages/nanogpt/src/contracts/route-contract.ts',
    };
  }

  const inputHeavy = operations.filter((operation) =>
    INPUT_HEAVY_OPS.has(operation),
  );
  const needsUndocumentedInputs =
    inputHeavy.length > 0 && model.limits.maxInputReferences === undefined;

  if (needsUndocumentedInputs) {
    return {
      ...base,
      status: 'restricted',
      reason:
        'Edit/utility/transform flags are present without a verified input-reference limit; image_generation/video_generation alone is not a usable generation proof.',
      evidence:
        generateContracts[0]?.id ??
        `${model.id} limits.maxInputReferences=unknown`,
    };
  }

  if (missingOps.length > 0 && generateContracts.length > 0) {
    return {
      ...base,
      status: 'restricted',
      reason: `Advertised ${missingOps.join(', ')} has no route contract; remaining generate ops are metadata-only.`,
      evidence: generateContracts.map((item) => item.id).join(','),
    };
  }

  if (missingOps.length > 0) {
    return {
      ...base,
      status: 'unresolved',
      reason: `Missing operation/input/response contract: ${missingOps.join(', ')}.`,
      evidence: 'packages/nanogpt/src/contracts/route-contract.ts',
    };
  }

  const primary = operations[0];
  const first =
    generateContracts[0] ??
    (primary ? contractsFor(primary, contracts)[0] : undefined);
  if (!first) {
    return {
      ...base,
      status: 'unresolved',
      reason: 'No matching route contract after operation mapping.',
      evidence: 'packages/nanogpt/src/contracts/route-contract.ts',
    };
  }

  return {
    ...base,
    status: 'usable',
    reason: `Adapter family ${first.id} exists. Evidence remains ${first.verification}; this is not a paid-generation proof.`,
    evidence: first.evidence.map((item) => item.url).join(' ') || first.id,
  };
}

/**
 * Reporting-only catalog audit. Not a runtime allowlist. Each exact catalog
 * ID appears once per catalog it was normalized from.
 */
export function auditCatalogCoverage(
  models: NanoGptModelDescriptor[],
  contracts: readonly RouteContract[],
): CoverageReport {
  const seen = new Set<string>();
  const rows: CoverageRow[] = [];
  for (const model of models) {
    const key = `${model.catalog}:${model.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(classifyModel(model, contracts));
  }
  rows.sort((a, b) => {
    if (a.catalog !== b.catalog) {
      return a.catalog.localeCompare(b.catalog);
    }
    return a.modelId.localeCompare(b.modelId);
  });
  const count = (status: CoverageStatus) =>
    rows.filter((row) => row.status === status).length;
  return {
    total: rows.length,
    usable: count('usable'),
    incompatible: count('incompatible'),
    restricted: count('restricted'),
    unresolved: count('unresolved'),
    rows,
  };
}

export function renderCoverageMarkdown(report: CoverageReport): string {
  const lines = [
    '# Model coverage audit (P5)',
    '',
    'Reporting-only. This is not a runtime allowlist. Broad',
    '`image_generation` / `video_generation` flags are not treated as proof of a',
    'usable generation route. Automated tests did not spend Nano-GPT credits.',
    '',
    `Generated from normalized catalog records. **${report.total}** exact IDs.`,
    '',
    '| Bucket | Count |',
    '| ------ | ----: |',
    `| usable | ${report.usable} |`,
    `| restricted | ${report.restricted} |`,
    `| unresolved | ${report.unresolved} |`,
    `| incompatible | ${report.incompatible} |`,
    '',
    '## Rows',
    '',
    '| Catalog | Model ID | Status | Operations | Reason | Evidence |',
    '| ------- | -------- | ------ | ---------- | ------ | -------- |',
  ];
  for (const row of report.rows) {
    const reason = row.reason.replaceAll('|', '\\|');
    const evidence = row.evidence.replaceAll('|', '\\|');
    lines.push(
      `| ${row.catalog} | \`${row.modelId}\` | ${row.status} | ${row.operations.join(', ') || '—'} | ${reason} | ${evidence} |`,
    );
  }
  lines.push(
    '',
    '## UNVERIFIED',
    '',
    '- Live paid Nano-GPT smoke per route family (no implementation budget/key).',
    '- Complete live catalog census (P1 stores hashes, not full bodies). Re-run',
    '  `npm run audit:coverage -- --live` when network access to nano-gpt.com is',
    '  available and record new hashes without spending credits.',
    '- Physical Android interruption sequence.',
    '',
  );
  return lines.join('\n');
}
