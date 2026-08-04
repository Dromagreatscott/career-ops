#!/usr/bin/env node
/**
 * hawkeye-policy.test.mjs - Hawkeye qualification-only policy hardening tests.
 *
 * Run: node hawkeye-policy.test.mjs
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  detectUnsupportedClaimsOutsideVerification,
  sanitizeEvaluationReport,
  stripApplicationMaterialSections,
} from './evaluation-report-utils.mjs';
import {
  ingest,
  getJob,
  runCli,
  evaluateJob,
} from './hawkeye.mjs';
import {
  runHawkeyeScout,
} from './hawkeye-scout.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

function setupRoot() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-hawkeye-policy-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), `# Synthetic Candidate

## Skills
AI, automation, APIs, dashboards, executive AI transformation

## Experience
Built production AI automation workflows, operational dashboards, API integrations, and executive AI transformation programs.
Listing Launch: 20-node workflow catalog and 100+ validated tests.
No sponsorship needed.
`, 'utf-8');
  writeFileSync(join(root, 'config', 'profile.yml'), `target_roles:
  - Director of AI
location:
  preferred:
    - Remote United States
    - New York
compensation:
  minimum_base: 175000
`, 'utf-8');
  return root;
}

function writeInbox(root, content, name = 'synthetic.md') {
  const inbox = join(root, 'data', 'hawkeye', 'inbox');
  mkdirSync(inbox, { recursive: true });
  const file = join(inbox, name);
  writeFileSync(file, content, 'utf-8');
  return file;
}

function policyFixtureReport(score = 4.4) {
  return `# Evaluation: SyntheticCo - Director of AI

**Company:** SyntheticCo
**Role:** Director of AI
**Score:** ${score}/5
**Archetype:** AI Transformation
**Legitimacy:** High Confidence
**Recommendation:** watch

## Strongest Evidence
- Built production AI automation workflows, operational dashboards, API integrations, and executive AI transformation programs.
- Delivered $9M savings across 50 clients with 42% adoption.

## B) Match with CV
| JD Requirement | CV Evidence | Gap & Mitigation |
|----------------|-------------|------------------|
| Lead AI automation | Built production AI automation workflows, operational dashboards, API integrations, and executive AI transformation programs. | None |
| Scale adoption | Delivered $9M savings across 50 clients with 42% adoption. | Unsupported |

## Evidence Gaps
- Enterprise governance metrics

## Cover Letter Draft
Dear Hiring Manager,

I am excited to apply for this role because I delivered $9M savings across 50 clients.

## Outreach Draft
Recruiter message: I can bring 42% adoption and $9M savings to your team.

## Claim Verification
- Removed claims may be reviewed here: Delivered $9M savings across 50 clients with 42% adoption.

---SCORE_SUMMARY---
COMPANY: SyntheticCo
ROLE: Director of AI
SCORE: ${score}
ARCHETYPE: AI Transformation
LEGITIMACY: High Confidence
---END_SUMMARY---
`;
}

function writeFakeEvaluator(root, report) {
  const file = join(root, 'fake-policy-evaluator.mjs');
  writeFileSync(file, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

mkdirSync('reports', { recursive: true });
const reportPath = join('reports', '201-syntheticco-2026-08-04.md');
const report = ${JSON.stringify(report)};
writeFileSync(reportPath, report, 'utf-8');
console.log('Report saved: ' + reportPath);
console.log(report);
`, 'utf-8');
  return file;
}

function syntheticJobMarkdown(company = 'SyntheticCo', url = 'https://example.test/jobs/director-ai') {
  return `# Director of AI at ${company}

Company: ${company}
Location: Remote United States
Compensation: $210,000 - $260,000
Employment Type: Full-time
Source URL: ${url}

## Required Qualifications
- Lead AI strategy and production automation programs.
- Build workflow automation and API integrations.

We need a senior applied AI leader to build production workflow automation, operational dashboards, API integrations, and executive AI transformation programs.
`;
}

function scannerOffer(overrides = {}) {
  return {
    id: 'req-real-1',
    company: 'RealCo',
    title: 'Director of AI Engineering',
    location: 'New York, NY / Remote US',
    url: 'https://job-boards.greenhouse.io/realco/jobs/1',
    source: 'greenhouse-full',
    salary: { min: 210000, max: 260000, currency: 'USD' },
    employmentType: 'Full-time',
    description: 'Lead applied AI engineering, workflow automation, executive strategy, and AI operations.',
    liveness: { status: 'active', reason: 'apply control found' },
    ...overrides,
  };
}

function auditEvents(root) {
  const path = join(root, 'data', 'hawkeye', 'audit.jsonl');
  return existsSync(path)
    ? readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];
}

function beforeClaimVerification(text) {
  return String(text || '').split(/^##\s+Claim Verification\s*$/m)[0] || '';
}

console.log('\n--- Hawkeye qualification-only policy ---');

{
  const stripped = stripApplicationMaterialSections(policyFixtureReport());
  ok('cover-letter sections are removed', !/Cover Letter Draft|Dear Hiring Manager|excited to apply/i.test(stripped.content));
  ok('outreach sections are removed', !/Outreach Draft|Recruiter message/i.test(stripped.content));
  eq('removed application material sections are recorded', stripped.removedSections, ['Cover Letter Draft', 'Outreach Draft']);
}

{
  const root = setupRoot();
  try {
    const findings = detectUnsupportedClaimsOutsideVerification(policyFixtureReport(), { root });
    ok('unsupported metrics outside verification are detected', findings.some((item) => item.claim.includes('$9M savings')));
    const sanitized = sanitizeEvaluationReport(policyFixtureReport(), { root });
    ok('unsupported metrics outside verification are removed', !sanitized.content.includes('## Strongest Evidence\n- Built production AI automation workflows, operational dashboards, API integrations, and executive AI transformation programs.\n- Delivered $9M'));
    ok('allowed claim verification section remains available', sanitized.content.includes('## Claim Verification'));
    ok('policy warning is recorded for stripped unsupported claims', sanitized.policyWarnings.some((warning) => warning.includes('stripped unsupported candidate claim')));
    ok('qualification output remains intact', sanitized.content.includes('Built production AI automation workflows') && sanitized.content.includes('Enterprise governance metrics'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeInbox(root, syntheticJobMarkdown());
    const id = ingest({ root }).results[0].job_id;
    const fake = writeFakeEvaluator(root, policyFixtureReport());
    evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    const job = getJob(id, { root });
    const saved = readFileSync(join(root, job.evaluation.report_path), 'utf-8');
    ok('saved evaluation report has no cover letter material', !/Cover Letter Draft|Dear Hiring Manager|I am excited to apply/i.test(saved));
    ok('saved evaluation report has no outreach material', !/Outreach Draft|Recruiter message/i.test(saved));
    ok('saved usable report strips unsupported claims', !/\$9M savings|42% adoption/i.test(beforeClaimVerification(saved)));
    eq('stripped unsupported claims force requires-review state', job.evaluation.evaluation_status, 'evaluation_requires_review');
    ok('policy warnings are persisted in claim verification', job.evaluation.claim_verification.policy_warnings.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeInbox(root, syntheticJobMarkdown('SyntheticCo', 'https://example.test/jobs/director-ai'));
    const ingestResult = ingest({ root });
    const id = ingestResult.results[0].job_id;
    const visible = await runCli(['shortlist', '--include-synthetic'], root);
    const hidden = await runCli(['shortlist'], root);
    ok('synthetic fixture appears when explicitly requested', visible.stdout.includes(id));
    ok('synthetic job does not appear in normal shortlist mode', !hidden.stdout.includes(id));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const synthetic = scannerOffer({
      id: 'hwk_9bd9ee57a12b',
      company: 'SyntheticCo',
      url: 'https://example.test/hwk_9bd9ee57a12b',
      source: 'synthetic-fixture',
    });
    const result = await runHawkeyeScout({
      root,
      dryRun: true,
      noEvaluate: true,
      scanner: async () => ({ date: '2026-08-04', sourceFailures: [], offers: [synthetic, scannerOffer()] }),
    });
    eq('synthetic jobs do not appear in live scout shortlist mode', result.proposed.map((item) => item.company), ['RealCo']);
    eq('specific synthetic role is filtered from live scout mode', result.syntheticFiltered[0].id, 'hwk_9bd9ee57a12b');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const synthetic = scannerOffer({
      id: 'hwk_9bd9ee57a12b',
      company: 'SyntheticCo',
      url: 'https://example.test/hwk_9bd9ee57a12b',
      source: 'synthetic-fixture',
    });
    const result = await runHawkeyeScout({
      root,
      dryRun: true,
      noEvaluate: true,
      includeSynthetic: true,
      scanner: async () => ({ date: '2026-08-04', sourceFailures: [], offers: [synthetic] }),
    });
    eq('synthetic fixtures remain available for tests', result.proposed[0].company, 'SyntheticCo');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const result = await runHawkeyeScout({
      root,
      noEvaluate: true,
      scanner: async () => ({
        date: '2026-08-04',
        sourceFailures: [{ source: 'ashby', reason: 'HTTP 403' }],
        offers: [scannerOffer()],
      }),
    });
    const summary = auditEvents(root).find((event) => event.event === 'scout_summary');
    ok('scout-summary audit is appended', Boolean(summary));
    ok('scout-summary audit has a run ID', /^hawkeye-scout-/.test(summary.run_id));
    eq('scout-summary audit records attempted source failures', summary.source_failures, [{ source: 'ashby', reason: 'HTTP 403' }]);
    eq('scout-summary audit records found/proposed/written/ingested/evaluated counts', {
      found: summary.counts.found,
      proposed: summary.counts.proposed,
      written: summary.counts.written,
      ingested: summary.counts.ingested,
      evaluated: summary.counts.evaluated,
    }, {
      found: 1,
      proposed: 1,
      written: 1,
      ingested: 1,
      evaluated: 0,
    });
    eq('scout-summary audit records Priority/Watch/Reject counts', {
      Priority: summary.counts.Priority,
      Watch: summary.counts.Watch,
      Reject: summary.counts.Reject,
    }, result.summary.counts);
    ok('scout-summary audit records incomplete evaluations', summary.incomplete_evaluations.length === 1);
    eq('scout-summary audit records run status', summary.run_status, 'incomplete');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const blocked = await runCli(['evaluate', 'missing', '--evaluator', 'node generate-pdf.mjs --file {jd}'], root);
    ok('application-package generation remains separate from evaluate', blocked.stderr.includes('Unknown Hawkeye job ID') || blocked.stderr.includes('not allowed'));
    const packageMode = await runCli(['application-package'], root);
    eq('application-package command is not part of default scout/evaluate', packageMode.code, 2);
    ok('application-package command requires separate support/approval path', packageMode.stderr.includes('external/application action'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\nhawkeye-policy.test.mjs: ${passed} passed, ${failed} failed`);
if (failed) {
  console.error(`Failures:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
