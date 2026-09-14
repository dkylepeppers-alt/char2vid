import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const config = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../.github/repository/${name}.json`, import.meta.url),
      'utf8',
    ),
  );
const tracking = config('task-tracking');
const repo = tracking.repository;
const settings = config('settings');
const ruleset = config('main-ruleset');
const releaseEnvironment = config('android-release-environment');
const mode = process.argv[2] ?? '--plan';
const modes = [
  '--plan',
  '--settings',
  '--milestones',
  '--rules',
  '--security',
  '--environment',
];

export const rulesetsPath = 'rulesets?includes_parents=false';

export function isOwnedRuleset(candidate, repository) {
  return (
    candidate.source_type === 'Repository' && candidate.source === repository
  );
}

export function collectionRows(response, path) {
  if (Array.isArray(response)) return response;
  if (
    path.includes('deployment-branch-policies') &&
    Array.isArray(response?.branch_policies)
  ) {
    return response.branch_policies;
  }
  throw new Error(`Expected a list from ${path}`);
}

export function assertExactDeploymentPolicies(policies, expected) {
  const unexpected = policies.find(
    (policy) => policy.name !== expected.name || policy.type !== expected.type,
  );
  if (unexpected !== undefined) {
    throw new Error(
      `Unexpected android-release deployment policy: ${unexpected.type} ${unexpected.name}. Inspect it manually; this helper will not delete policies.`,
    );
  }
  if (policies.length !== 1) {
    throw new Error(
      `Expected exactly one ${expected.type} ${expected.name} deployment policy; found ${policies.length}.`,
    );
  }
}

function api(method, path, payload) {
  const args = [
    'api',
    '--method',
    method,
    `repos/${repo}/${path}`.replace(/\/$/, ''),
  ];
  if (payload !== undefined) args.push('--input', '-');
  const output = execFileSync('gh', args, {
    input: payload === undefined ? undefined : JSON.stringify(payload),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
  }).trim();
  return output ? JSON.parse(output) : undefined;
}

function pages(path) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const response = api(
      'GET',
      `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    const rows = collectionRows(response, path);
    all.push(...rows);
    if (rows.length < 100) return all;
  }
}

function run() {
  if (process.argv.length > 3 || !modes.includes(mode)) {
    throw new Error(`Use one of: ${modes.join(', ')}`);
  }
  if (repo !== 'dkylepeppers-alt/char2vid') {
    throw new Error(
      'This setup command is scoped to dkylepeppers-alt/char2vid.',
    );
  }

  if (mode === '--plan') {
    console.log(
      JSON.stringify(
        {
          repo,
          settings,
          ruleset,
          releaseEnvironment,
          milestones: tracking.milestones,
          issues: tracking.issues,
        },
        null,
        2,
      ),
    );
  } else {
    execFileSync('gh', ['auth', 'status'], { stdio: 'inherit' });
    const metadata = api('GET', '');
    if (metadata.full_name !== repo)
      throw new Error('Repository identity mismatch.');

    if (mode === '--settings') {
      api('PATCH', '', settings);
      const actual = api('GET', '');
      for (const [key, value] of Object.entries(settings)) {
        if (actual[key] !== value)
          throw new Error(`Setting did not persist: ${key}`);
      }
      console.log(`Verified merge and repository settings for ${repo}.`);
    }

    if (mode === '--milestones') {
      const milestones = pages('milestones?state=all');
      for (const title of tracking.milestones) {
        const matches = milestones.filter((item) => item.title === title);
        if (matches.length > 1)
          throw new Error(`Duplicate milestone title: ${title}`);
        const milestone = matches[0] ?? api('POST', 'milestones', { title });
        for (const issue of tracking.issues.filter(
          (item) => item.milestone === title,
        )) {
          const current = api('GET', `issues/${issue.number}`);
          if (!current.title.startsWith(`[${issue.task}]`))
            throw new Error(`Task issue identity mismatch: #${issue.number}`);
          if (
            current.milestone &&
            current.milestone.number !== milestone.number
          ) {
            throw new Error(
              `Issue #${issue.number} already belongs to another milestone; inspect it before changing it.`,
            );
          }
          if (current.milestone?.number !== milestone.number) {
            api('PATCH', `issues/${issue.number}`, {
              milestone: milestone.number,
            });
          }
        }
        console.log(`Configured ${title}.`);
      }
    }

    if (mode === '--rules') {
      const branch = encodeURIComponent(metadata.default_branch);
      const head = api('GET', `git/ref/heads/${branch}`).object.sha;
      const checks = api(
        'GET',
        `commits/${head}/check-runs?check_name=ci-gate&filter=latest&per_page=100`,
      );
      if (
        !checks.check_runs.some(
          (check) =>
            check.name === 'ci-gate' &&
            check.head_sha === head &&
            check.app?.slug === 'github-actions' &&
            check.status === 'completed' &&
            check.conclusion === 'success',
        )
      ) {
        throw new Error(
          'Run Checks successfully on the current default-branch commit before enabling the required ci-gate.',
        );
      }
      const matches = pages(rulesetsPath).filter(
        (item) => item.name === ruleset.name && isOwnedRuleset(item, repo),
      );
      if (matches.length > 1)
        throw new Error(
          'Duplicate foundation rulesets; inspect them before continuing.',
        );
      const matchingCheck = checks.check_runs.find(
        (check) =>
          check.name === 'ci-gate' &&
          check.app?.slug === 'github-actions' &&
          check.conclusion === 'success',
      );
      ruleset.rules.find(
        (rule) => rule.type === 'required_status_checks',
      ).parameters.required_status_checks[0].integration_id =
        matchingCheck.app.id;
      if (api('GET', `git/ref/heads/${branch}`).object.sha !== head)
        throw new Error(
          'Default branch changed during verification; rerun the command.',
        );
      const existing = matches[0];
      if (existing && !isOwnedRuleset(existing, repo)) {
        throw new Error(
          'Refusing to update a ruleset not owned by this repository.',
        );
      }
      const saved = api(
        existing ? 'PUT' : 'POST',
        existing ? `rulesets/${existing.id}` : 'rulesets',
        ruleset,
      );
      const verified = api('GET', `rulesets/${saved.id}`);
      if (verified.enforcement !== 'active')
        throw new Error('Ruleset was not activated.');
      console.log(
        `Verified active ruleset ${saved.id} requiring the GitHub Actions ci-gate.`,
      );
    }

    if (mode === '--security') {
      api('PUT', 'vulnerability-alerts');
      api('PUT', 'automated-security-fixes');
      api('PATCH', '', {
        security_and_analysis: {
          secret_scanning: { status: 'enabled' },
          secret_scanning_push_protection: { status: 'enabled' },
        },
      });
      console.log(
        'Requested dependency alerts, security fixes, secret scanning, and push protection. Inspect GitHub Security settings for availability and status.',
      );
    }

    if (mode === '--environment') {
      const environmentName = encodeURIComponent(releaseEnvironment.name);
      const environment = api(
        'PUT',
        `environments/${environmentName}`,
        releaseEnvironment.settings,
      );
      if (
        environment.name !== releaseEnvironment.name ||
        environment.deployment_branch_policy?.custom_branch_policies !== true ||
        environment.deployment_branch_policy?.protected_branches !== false
      ) {
        throw new Error('Release environment settings did not persist.');
      }

      const policyPath = `environments/${environmentName}/deployment-branch-policies`;
      const policies = pages(policyPath);
      if (policies.length > 0) {
        assertExactDeploymentPolicies(
          policies,
          releaseEnvironment.branch_policy,
        );
      } else {
        api('POST', policyPath, releaseEnvironment.branch_policy);
      }
      assertExactDeploymentPolicies(
        pages(policyPath),
        releaseEnvironment.branch_policy,
      );
      console.log(
        `Verified ${releaseEnvironment.name} with a ${releaseEnvironment.branch_policy.name} deployment policy. Add signing secrets manually.`,
      );
    }
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  run();
}
