#!/usr/bin/env node
/**
 * hawkeye-scout.test.mjs - Hawkeye scout adapter tests.
 *
 * Run: node hawkeye-scout.test.mjs
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  classifyScoutBucket,
  isSyntheticOffer,
  normalizeScannerOffer,
  runHawkeyeScout,
  scoutPortalConfig,
  suppressDuplicateScoutOffers,
} from './hawkeye-scout.mjs';
import { getJob } from './hawkeye.mjs';

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
  const root = mkdtempSync(join(tmpdir(), 'career-ops-hawkeye-scout-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), `# Synthetic Candidate

## Skills
AI, Applied AI, Automation, Executive Leadership, Strategy, Operations, API, Workflow

## Experience
Built production AI automation workflows and led executive AI transformation programs.
No sponsorship needed.
`, 'utf-8');
  writeFileSync(join(root, 'config', 'profile.yml'), `target_roles:
  - Director of AI
  - Head of Applied AI
location:
  preferred:
    - Remote United States
    - New York
    - New Jersey
compensation:
  minimum_base: 175000
`, 'utf-8');
  return root;
}

function scannerPayload(overrides = {}) {
  return {
    date: '2026-08-04',
    sources: ['greenhouse'],
    postingsKept: 1,
    unreachableBoards: 0,
    sourceFailures: [],
    offers: [
      {
        id: 'req-1',
        company: 'SyntheticCo',
        title: 'Director of AI Engineering',
        location: 'New York, NY / Remote US',
        url: 'https://job-boards.greenhouse.io/synthetic/jobs/1?utm_source=x',
        source: 'greenhouse-full',
        postedAt: '2026-08-03',
        dateStatus: 'dated',
        salary: { min: 210000, max: 260000, currency: 'USD' },
        employmentType: 'Full-time',
        description: 'Lead applied AI engineering, workflow automation, executive strategy, and AI operations.',
        liveness: { status: 'active', reason: 'apply control found' },
      },
    ],
    ...overrides,
  };
}

function writeFakeEvaluator(root, score = 4.6, mode = 'success') {
  const file = join(root, `fake-scout-evaluator-${mode}.mjs`);
  const report = mode === 'unsupported'
    ? `# Evaluation: SyntheticCo - Director of AI Engineering

**Company:** SyntheticCo
**Role:** Director of AI Engineering
**Score:** ${score}/5
**Archetype:** AI Transformation
**Legitimacy:** High Confidence
**Recommendation:** strong apply

## Strongest Evidence
- Built production AI automation workflows and led executive AI transformation programs.
- Delivered $9M savings across 50 clients.

## B) Match with CV
| JD Requirement | CV Evidence | Gap & Mitigation |
|----------------|-------------|------------------|
| Lead AI automation | Built production AI automation workflows and led executive AI transformation programs. | None |
| Deliver massive quantified savings | Delivered $9M savings across 50 clients. | Unsupported |
`
    : `# Evaluation: SyntheticCo - Director of AI Engineering

**Company:** SyntheticCo
**Role:** Director of AI Engineering
**Score:** ${score}/5
**Archetype:** AI Transformation
**Legitimacy:** High Confidence
**Recommendation:** strong apply

## Machine Summary
\`\`\`yaml
company: SyntheticCo
role: Director of AI Engineering
advertised_comp: "$210000-$260000 USD"
\`\`\`

## Strongest Evidence
- Built production AI automation workflows and led executive AI transformation programs.

## Evidence Gaps
- Enterprise governance metrics

## B) Match with CV
Career Ops rationale: strong applied AI leadership alignment.

---SCORE_SUMMARY---
COMPANY: SyntheticCo
ROLE: Director of AI Engineering
SCORE: ${score}
ARCHETYPE: AI Transformation
LEGITIMACY: High Confidence
---END_SUMMARY---
`;
  writeFileSync(file, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
mkdirSync('reports', { recursive: true });
const reportPath = join('reports', '101-syntheticco-2026-08-04.md');
writeFileSync(reportPath, ${JSON.stringify(report)}, 'utf-8');
console.log('Report saved: ' + reportPath);
console.log(${JSON.stringify(report)});
`, 'utf-8');
  return `${process.execPath} ${file} --file {jd}`;
}

function auditLines(root) {
  const audit = join(root, 'data', 'hawkeye', 'audit.jsonl');
  return existsSync(audit) ? readFileSync(audit, 'utf-8').trim().split('\n').filter(Boolean) : [];
}

console.log('\n--- Hawkeye scout adapter ---');

{
  const normalized = normalizeScannerOffer(scannerPayload().offers[0], { discoveredDate: '2026-08-04' });
  eq('scanner-to-Hawkeye normalization maps title', normalized.record.title, 'Director of AI Engineering');
  eq('scanner-to-Hawkeye normalization maps canonical source URL', normalized.record.source_url, 'https://job-boards.greenhouse.io/synthetic/jobs/1');
  eq('scanner-to-Hawkeye normalization maps source', normalized.record.source, 'greenhouse-full');
  eq('scanner-to-Hawkeye normalization maps compensation', normalized.record.compensation, { min: 210000, max: 260000, currency: 'USD' });
  ok('scanner-to-Hawkeye normalization carries JD text', normalized.record.description.includes('Lead applied AI engineering'));
}

{
  const offers = [
    scannerPayload().offers[0],
    { ...scannerPayload().offers[0], url: 'https://job-boards.greenhouse.io/synthetic/jobs/1?utm_campaign=y' },
    { ...scannerPayload().offers[0], id: 'req-2', url: 'https://job-boards.greenhouse.io/synthetic/jobs/2', title: 'Director of AI Engineering' },
    { ...scannerPayload().offers[0], id: 'req-3', url: 'https://job-boards.greenhouse.io/synthetic/jobs/3', title: 'Head of Applied AI' },
  ];
  const existingJobs = [{
    fields: {
      source_url: { value: 'https://job-boards.greenhouse.io/synthetic/jobs/3' },
      company: { value: 'SyntheticCo' },
      title: { value: 'Head of Applied AI' },
      location: { value: 'Remote US' },
    },
    external_id: 'req-3',
  }];
  const result = suppressDuplicateScoutOffers(offers, existingJobs);
  eq('duplicate suppression keeps only unique new offers', result.kept.length, 1);
  eq('duplicate suppression records skipped count', result.duplicates.length, 3);
}

{
  const malformed = normalizeScannerOffer({ company: 'BadCo', url: 'https://example.com/job' });
  eq('malformed scanner result is rejected', malformed.ok, false);
  ok('malformed scanner result records reason', malformed.reason.includes('missing title'));
}

{
  const live = normalizeScannerOffer({ ...scannerPayload().offers[0], liveness: { status: 'active' } });
  const dead = normalizeScannerOffer({ ...scannerPayload().offers[0], url: 'https://example.com/dead', liveness: { status: 'expired', reason: 'closed' } });
  eq('live status is kept', live.ok, true);
  eq('dead status is skipped', dead.ok, false);
  ok('dead status reason is recorded', dead.reason.includes('expired'));
}

{
  const root = setupRoot();
  const beforeAudit = auditLines(root).length;
  const result = await runHawkeyeScout({
    root,
    dryRun: true,
    noEvaluate: true,
    includeSynthetic: true,
    scanner: async () => scannerPayload(),
  });
  eq('dry-run finds proposed jobs', result.proposed.length, 1);
  ok('dry-run writes nothing to inbox', !existsSync(join(root, 'data', 'hawkeye', 'inbox')));
  eq('dry-run appends no audit', auditLines(root).length, beforeAudit);
}

{
  const root = setupRoot();
  const evaluator = writeFakeEvaluator(root, 4.7);
  const result = await runHawkeyeScout({
    root,
    scanner: async () => scannerPayload(),
    evaluator,
    includeSynthetic: true,
  });
  eq('evaluator handoff evaluates one ingested role', result.evaluated.length, 1);
  eq('evaluator handoff preserves canonical score', result.summary.counts.Priority, 1);
  ok('audit append includes scout event', auditLines(root).some((line) => line.includes('"event":"scout"')));
}

{
  eq('Priority/Watch/Reject classification maps high score', classifyScoutBucket({ evaluation: { canonical_score: 4.5 } }), 'Priority');
  eq('Priority/Watch/Reject classification maps mid score', classifyScoutBucket({ evaluation: { canonical_score: 3.7 } }), 'Watch');
  eq('Priority/Watch/Reject classification maps low score', classifyScoutBucket({ evaluation: { canonical_score: 3.2 } }), 'Reject');
  eq('Priority/Watch/Reject classification honors hard mismatches', classifyScoutBucket({ evaluation: { canonical_score: 4.8, hard_mismatches: ['junior or entry-level role'] } }), 'Reject');
}

{
  const root = setupRoot();
  const evaluator = writeFakeEvaluator(root, 4.6, 'unsupported');
  const result = await runHawkeyeScout({
    root,
    scanner: async () => scannerPayload(),
    evaluator,
    includeSynthetic: true,
  });
  const job = getJob(result.evaluated[0].job_id, { root });
  ok('unsupported evidence remains excluded', !JSON.stringify(job.evaluation.strongest_evidence).includes('$9M'));
}

{
  const root = setupRoot();
  const result = await runHawkeyeScout({
    root,
    noEvaluate: true,
    includeSynthetic: true,
    scanner: async () => scannerPayload({
      unreachableBoards: 1,
      sourceFailures: [{ source: 'ashby', reason: 'HTTP 403' }],
      offers: scannerPayload().offers,
    }),
  });
  eq('one failed source does not abort full run', result.ingest.imported, 1);
  eq('source failure is recorded', result.sourceFailures[0].source, 'ashby');
}

{
  const root = setupRoot();
  const realOffer = {
    ...scannerPayload().offers[0],
    id: 'real-1',
    company: 'RealCo',
    url: 'https://job-boards.greenhouse.io/realco/jobs/2',
  };
  const result = await runHawkeyeScout({
    root,
    dryRun: true,
    noEvaluate: true,
    scanner: async () => scannerPayload({ offers: [scannerPayload().offers[0], realOffer] }),
  });
  eq('live scout mode filters synthetic fixture offers', result.proposed.map((item) => item.company), ['RealCo']);
  eq('synthetic fixture filter records skipped synthetic count', result.syntheticFiltered.length, 1);
  ok('isSyntheticOffer detects the synthetic fixture', isSyntheticOffer(scannerPayload().offers[0]));
}

{
  const root = setupRoot();
  const result = await runHawkeyeScout({
    root,
    dryRun: true,
    noEvaluate: true,
    includeSynthetic: true,
    scanner: async () => scannerPayload(),
  });
  eq('synthetic fixtures remain available when explicitly requested', result.proposed[0].company, 'SyntheticCo');
}

{
  const config = scoutPortalConfig({ location: 'NYC metro', remote: true });
  ok('scout config targets David AI leadership roles', config.includes('Director of AI') && config.includes('Head of Applied AI'));
  ok('scout config targets NYC/NJ/remote geography', config.includes('New York') && config.includes('New Jersey') && config.includes('Remote'));
}

console.log(`\nhawkeye-scout.test.mjs: ${passed} passed, ${failed} failed`);
if (failed) {
  console.error(`Failures:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
