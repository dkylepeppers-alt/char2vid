import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  assertExactDeploymentPolicies,
  collectionRows,
  environmentPutSettings,
  isOwnedRuleset,
  rulesetsPath,
} from '../../scripts/configure-repository.mjs';

describe('repository ruleset selection', () => {
  it('requests repository-only rulesets', () => {
    expect(rulesetsPath).toBe('rulesets?includes_parents=false');
  });

  it('rejects an inherited ruleset with the foundation name', () => {
    expect(
      isOwnedRuleset(
        {
          name: 'Main branch protection',
          source_type: 'Organization',
          source: 'dkylepeppers-alt',
        },
        'dkylepeppers-alt/char2vid',
      ),
    ).toBe(false);
  });

  it('accepts only the ruleset sourced from this repository', () => {
    expect(
      isOwnedRuleset(
        {
          name: 'Main branch protection',
          source_type: 'Repository',
          source: 'dkylepeppers-alt/char2vid',
        },
        'dkylepeppers-alt/char2vid',
      ),
    ).toBe(true);
  });
});

describe('repository API collections', () => {
  it('reads environment deployment policies from their response envelope', () => {
    expect(
      collectionRows(
        {
          total_count: 1,
          branch_policies: [{ id: 1, name: 'main', type: 'branch' }],
        },
        'environments/android-release/deployment-branch-policies',
      ),
    ).toEqual([{ id: 1, name: 'main', type: 'branch' }]);
  });

  it('fails closed when the release environment has an extra policy', () => {
    expect(() =>
      assertExactDeploymentPolicies(
        [
          { name: 'main', type: 'branch' },
          { name: 'release-*', type: 'tag' },
        ],
        { name: 'main', type: 'branch' },
      ),
    ).toThrow('Unexpected android-release deployment policy: tag release-*');
  });

  it('accepts exactly one matching main branch policy', () => {
    expect(() =>
      assertExactDeploymentPolicies([{ name: 'main', type: 'branch' }], {
        name: 'main',
        type: 'branch',
      }),
    ).not.toThrow();
  });

  it('omits prevent_self_review when no reviewers are configured', () => {
    expect(
      environmentPutSettings({
        wait_timer: 0,
        prevent_self_review: false,
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      }),
    ).toEqual({
      wait_timer: 0,
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    });
  });

  it('keeps the committed android-release payload applicable without reviewers', () => {
    const payload = JSON.parse(
      readFileSync(
        new URL(
          '../../.github/repository/android-release-environment.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(payload.settings).not.toHaveProperty('prevent_self_review');
    expect(environmentPutSettings(payload.settings)).toEqual(payload.settings);
  });
});
