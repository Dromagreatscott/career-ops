#!/usr/bin/env node
/**
 * hawkeye.test.mjs - focused tests for the local Hawkeye scouting MVP.
 *
 * Run: node hawkeye.test.mjs
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
  classifyDuplicate,
  decide,
  evaluateJob,
  getJob,
  ingest,
  normalizeSourceFile,
  runCli,
  shortlist,
} from './hawkeye.mjs';
import {
  parseEvaluationMetadata,
  safeReportSlug,
  verifyReportClaims,
} from './evaluation-report-utils.mjs';

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
  const root = mkdtempSync(join(tmpdir(), 'career-ops-hawkeye-'));
  writeFileSync(join(root, 'cv.md'), `# Synthetic Candidate

## Skills
AI, Automation, Workflow, API, Integration, Dashboard, Strategy, Executive Leadership, Workday

## Experience
Built production AI automation workflows, operational dashboards, API integrations, and business outcomes for business teams.
Listing Launch: 20-node workflow catalog and 100+ validated tests.
No sponsorship needed.
`, 'utf-8');
  writeFileSync(join(root, 'config-profile.tmp'), '', 'utf-8');
  return root;
}

function writeProfile(root) {
  const configDir = join(root, 'config');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'profile.yml'), `target_roles:
  - Director of AI
  - Principal AI Automation Architect
location:
  preferred:
    - Remote United States
    - New York
    - New Jersey
compensation:
  minimum_base: 175000
`, 'utf-8');
}

function writeInbox(root, name, content) {
  const inbox = join(root, 'data', 'hawkeye', 'inbox');
  mkdirSync(inbox, { recursive: true });
  const file = join(inbox, name);
  writeFileSync(file, content, 'utf-8');
  return file;
}

function writeReport(root, num, company, role, score) {
  const reports = join(root, 'reports');
  mkdirSync(reports, { recursive: true });
  const file = join(reports, `${String(num).padStart(3, '0')}-${company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-2026-08-02.md`);
  writeFileSync(file, `# Evaluation

**Company:** ${company}
**Role:** ${role}
**Score:** ${score}/5

## Machine Summary
\`\`\`yaml
company: ${company}
role: ${role}
advertised_comp: "$210000-$260000 USD"
\`\`\`
`, 'utf-8');
  return file;
}

function writeFakeEvaluator(root, mode = 'success', score = 4.6) {
  const file = join(root, `fake-evaluator-${mode}.mjs`);
  let report = '';
  if (mode === 'unparseable') {
    report = 'not a Career Ops report';
  } else if (mode === 'missing-score') {
    report = '# Evaluation: SyntheticCo — Director of AI\\n\\n## Strongest Evidence\\n- Career Ops rationale without a score\\n';
  } else if (mode === 'conflict') {
    report = `# Evaluation: WrongCo — Director of AI

**Company:** WrongCo
**Role:** Director of AI
**Score:** 4.2/5

---SCORE_SUMMARY---
COMPANY: WrongCo
ROLE: Director of AI
SCORE: 4.2
ARCHETYPE: AI Transformation
LEGITIMACY: High Confidence
---END_SUMMARY---
`;
  } else if (mode === 'no-summary') {
    report = `# Evaluation: unknown — unknown

**Date:** 2026-08-02
**Archetype:** unknown
**Score:** ?/5
**Legitimacy:** unknown

---

# Evaluation: SyntheticCo — Director of AI

**Score:** ${score}/5
**Archetype:** AI Transformation
**Legitimacy:** Proceed with Caution

## B) Match with CV
| JD Requirement | CV Evidence | Gap & Mitigation |
|----------------|-------------|------------------|
| Lead applied AI automation programs | Built production AI automation workflows, operational dashboards, and API integrations for business teams. | None |
| Build workflow automation | Listing Launch: 20-node workflow catalog and 100+ validated tests. | None |
`;
  } else if (mode === 'unsupported') {
    report = `# Evaluation: SyntheticCo — Director of AI

**Score:** ${score}/5
**Archetype:** AI Transformation
**Legitimacy:** Proceed with Caution

## B) Match with CV
| JD Requirement | CV Evidence | Gap & Mitigation |
|----------------|-------------|------------------|
| Build dashboards | Built production AI automation workflows, operational dashboards, and API integrations for business teams. | Add unsupported 40% savings. |

## Cover Letter Draft
- Delivered $1.2M+ ROI for 15+ clients across 10+ industries.
- Designed Attorney Timekeeper with 95% client adoption and 98% retention.
`;
  } else if (mode === 'contradictory') {
    report = `# Evaluation: SyntheticCo — Director of AI

**Score:** ${score}/5
**Archetype:** AI Transformation
**Legitimacy:** High Confidence

## Strongest Evidence
- Sponsorship required for this candidate.
`;
  } else {
    report = `# Evaluation: SyntheticCo — Director of AI

**Company:** SyntheticCo
**Role:** Director of AI
**Score:** ${score}/5
**Archetype:** AI Transformation
**Legitimacy:** High Confidence
**Recommendation:** strong apply

## Machine Summary
\`\`\`yaml
company: SyntheticCo
role: Director of AI
advertised_comp: "$210000-$260000 USD"
\`\`\`

## Strongest Evidence
- Production AI automation programs
- Executive stakeholder communication

## Evidence Gaps
- Enterprise governance metrics

## Hard Mismatches
- None

## B) Match with CV
Career Ops rationale: strong applied AI leadership alignment.

---SCORE_SUMMARY---
COMPANY: SyntheticCo
ROLE: Director of AI
SCORE: ${score}
ARCHETYPE: AI Transformation
LEGITIMACY: High Confidence
---END_SUMMARY---
`;
  }
  writeFileSync(file, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const mode = ${JSON.stringify(mode)};
if (mode === 'failure') {
  console.error('synthetic evaluator failure');
  process.exit(7);
}

mkdirSync('reports', { recursive: true });
const reportPath = join('reports', '099-syntheticco-2026-08-02.md');
const report = ${JSON.stringify(report)};
writeFileSync(reportPath, report, 'utf-8');
console.log(\`✅  Report saved: \${reportPath}\`);
console.log(report);
`, 'utf-8');
  return file;
}

function writeFakeOpenAiEvaluator(root, mode = 'success', score = 4.6) {
  const file = join(root, 'openai-eval.mjs');
  const report = `# Evaluation: SyntheticCo — Director of AI

**Company:** SyntheticCo
**Role:** Director of AI
**Score:** ${score}/5
**Archetype:** AI Transformation
**Legitimacy:** High Confidence
**Recommendation:** strong apply

## Strongest Evidence
- NVIDIA-backed Career Ops evaluation

## Evidence Gaps
- Verified enterprise governance metric

---SCORE_SUMMARY---
COMPANY: SyntheticCo
ROLE: Director of AI
SCORE: ${score}
ARCHETYPE: AI Transformation
LEGITIMACY: High Confidence
---END_SUMMARY---
`;
  const invalidReport = `# Evaluation: SyntheticCo — Director of AI

**Company:** SyntheticCo
**Role:** Director of AI

---SCORE_SUMMARY---
COMPANY: SyntheticCo
ROLE: Director of AI
ARCHETYPE: AI Transformation
LEGITIMACY: High Confidence
---END_SUMMARY---
`;
  writeFileSync(file, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const mode = ${JSON.stringify(mode)};
if (mode === 'timeout') {
  await new Promise(() => {});
} else if (mode === 'quota') {
  console.error('HTTP 429 rate limit for key ' + process.env.OPENAI_API_KEY);
  process.exit(1);
} else if (mode === 'server') {
  console.error('HTTP 503 temporarily unavailable');
  process.exit(1);
}

const url = process.argv[process.argv.indexOf('--url') + 1] || '';
const model = process.argv[process.argv.indexOf('--model') + 1] || '';
const key = process.env.OPENAI_API_KEY || '';
if (!key) {
  console.error('OPENAI_API_KEY missing');
  process.exit(1);
}
if (url !== 'https://integrate.api.nvidia.com/v1') {
  console.error('unexpected url ' + url);
  process.exit(1);
}
if (model !== 'nvidia/llama-3.3-nemotron-super-49b-v1.5') {
  console.error('unexpected model ' + model);
  process.exit(1);
}

mkdirSync('reports', { recursive: true });
const reportPath = join('reports', '100-syntheticco-2026-08-02.md');
const report = mode === 'invalid-score' ? ${JSON.stringify(invalidReport)} : ${JSON.stringify(report)};
writeFileSync(reportPath, report, 'utf-8');
writeFileSync('provider-observed.json', JSON.stringify({
  provider_key_present: Boolean(key),
  provider_key_expected: key === 'unit-test-nvidia-secret',
  openai_key_present: Boolean(process.env.OPENAI_API_KEY),
  nvidia_key_present: Boolean(process.env.NVIDIA_API_KEY),
  base_url: url,
  model,
}, null, 2));
console.log('Report saved: ' + reportPath);
console.log(report);
`, 'utf-8');
  return file;
}

function ingestSynthetic(root) {
  writeProfile(root);
  writeInbox(root, 'synthetic.md', directorTxt.replaceAll('Acme AI', 'SyntheticCo').replace('https://jobs.example.test/acme/director-ai', 'https://example.test/jobs/director-ai'));
  return ingest({ root }).results[0].job_id;
}

function auditLines(root) {
  return readFileSync(join(root, 'data', 'hawkeye', 'audit.jsonl'), 'utf-8').trim().split('\n').filter(Boolean);
}

const longDescription = `We need a senior applied AI leader to build production workflow automation, agent orchestration, operational dashboards, API integrations, and executive AI transformation programs. `.repeat(10);

const directorTxt = `# Director of AI at Acme AI

Company: Acme AI
Location: Remote United States
Compensation: $210,000 - $260,000
Employment Type: Full-time
Source URL: https://jobs.example.test/acme/director-ai

## Required Qualifications
- Lead AI strategy and production automation programs.
- Build workflow automation and API integrations.

## Preferred Qualifications
- Workday experience.

${longDescription}
`;

const markdownJob = `# Principal AI Automation Architect at Beta Systems

Company: Beta Systems
Location: Hybrid - New York, NY
Compensation: $190,000 - $220,000
Source URL: https://jobs.example.test/beta/principal-ai-automation

## Required Qualifications
- Lead AI automation architecture and dashboards.

${longDescription}
`;

const sparseJob = `We need help with automation.

Responsibilities:
- Work with teams.
`;

const mismatchJob = `# Applied Scientist at Locked Lab

Company: Locked Lab
Location: On-site - Seattle
Compensation: $120,000 - $150,000
Source URL: https://jobs.example.test/locked/applied-scientist

## Required Qualifications
- Research Scientist or Applied Scientist background required.
- Active security clearance required.
- PhD required.

${longDescription}
`;

console.log('\n--- Hawkeye local scouting MVP ---');

{
  const report = `# Evaluation: unknown — unknown

**Score:** ?/5

# Evaluation: SyntheticCo — Director of AI

**Score:** 4.2/5
**Archetype:** AI Transformation
**Legitimacy:** Proceed with Caution
`;
  const metadata = parseEvaluationMetadata(report);
  eq('fallback company parsing from evaluation heading', metadata.company, 'SyntheticCo');
  eq('fallback role parsing from evaluation heading', metadata.role, 'Director of AI');
  eq('fallback score parsing from report body', metadata.score, 4.2);
  eq('fallback archetype parsing from report body', metadata.archetype, 'AI Transformation');
  eq('fallback legitimacy parsing from report body', metadata.legitimacy, 'Proceed with Caution');
  eq('safe report filename slug uses parsed metadata', safeReportSlug(metadata.company, metadata.role), 'syntheticco-director-of-ai');
}

{
  const metadata = parseEvaluationMetadata('# Evaluation: Unknown — Unknown\n\nNo machine metadata.');
  eq('missing metadata remains unavailable to caller', metadata.company, '');
  eq('missing score remains null', metadata.score, null);
}

{
  let threw = false;
  try {
    parseEvaluationMetadata('**Score:** 4.2/5\n\n---SCORE_SUMMARY---\nSCORE: 3.1\n---END_SUMMARY---');
  } catch (err) {
    threw = err.message.includes('Ambiguous');
  }
  ok('ambiguous metadata rejected', threw);
}

{
  const root = setupRoot();
  try {
    const verification = verifyReportClaims('Listing Launch: 20-node workflow catalog and 100+ validated tests.', { root });
    eq('verified numeric claim accepted', verification.status, 'evaluation_complete');
    ok('verified claim recorded', verification.verified.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const verification = verifyReportClaims('Produced business outcomes through production AI automation workflows and operational dashboards.', { root });
    eq('supported paraphrase accepted', verification.status, 'evaluation_complete');
    ok('supported paraphrase recorded', verification.supported_but_paraphrased.length > 0 || verification.verified.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const verification = verifyReportClaims('Delivered $1.2M+ ROI for 15+ clients across 10+ industries.', { root });
    eq('unsupported numeric claim requires review', verification.status, 'evaluation_requires_review');
    ok('unsupported numeric claim recorded', verification.unsupported.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const verification = verifyReportClaims('Sponsorship required for this candidate.', { root });
    eq('contradictory claim rejected', verification.status, 'evaluation_rejected_untrusted');
    ok('contradictory claim recorded', verification.contradictory.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeReport(root, 1, 'Acme AI', 'Director of AI', 4.6);
    const file = writeInbox(root, 'director-ai.txt', directorTxt);
    const before = readFileSync(file, 'utf-8');
    const result = ingest({ root });
    const after = readFileSync(file, 'utf-8');
    const job = getJob(result.results[0].job_id, { root });

    eq('TXT import reads one file', result.files_read, 1);
    eq('TXT import creates one job', result.jobs_total, 1);
    eq('source file immutability after TXT import', after, before);
    eq('Career Ops report handoff linked existing report', job.evaluation.status, 'linked_existing_career_ops_report');
    eq('canonical 1-5 score preserved', job.evaluation.canonical_score, 4.6);
    ok('JD handoff artifact written locally', existsSync(join(root, job.evaluation.reference)) || existsSync(join(root, 'data', 'hawkeye', 'jds', `${job.job_id}.md`)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeReport(root, 2, 'Beta Systems', 'Principal AI Automation Architect', 4.1);
    writeInbox(root, 'principal-ai.md', markdownJob);
    const result = ingest({ root });
    const job = getJob(result.results[0].job_id, { root });
    eq('Markdown import creates one job', result.jobs_total, 1);
    eq('Markdown required qualification extracted', job.required_qualifications[0], 'Lead AI automation architecture and dashboards.');
    eq('Markdown job groups as good from Career Ops score', shortlist({ root }).good[0].job_id, job.job_id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeInbox(root, 'json-job.json', JSON.stringify({
      company: 'JsonCo',
      title: 'Director of AI',
      location: 'Remote United States',
      compensation: { min: 205000, max: 240000, currency: 'USD' },
      employment_type: 'Full-time',
      source_url: 'https://jobs.example.test/jsonco/director-ai',
      description: longDescription,
      required_qualifications: ['Lead production AI systems.'],
      preferred_qualifications: ['Talent systems experience.'],
    }));
    const result = ingest({ root });
    const job = getJob(result.results[0].job_id, { root });
    eq('JSON import creates one job', result.jobs_total, 1);
    eq('JSON compensation extracted', job.fields.compensation.value.min, 205000);
    eq('JSON preferred qualification preserved', job.preferred_qualifications[0], 'Talent systems experience.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    const file = writeInbox(root, 'sparse.txt', sparseJob);
    const normalized = normalizeSourceFile(file);
    eq('missing company is unavailable', normalized.fields.company.status, 'unavailable');
    eq('missing location is unavailable', normalized.fields.location.status, 'unavailable');
    eq('missing compensation is unavailable', normalized.fields.compensation.status, 'unavailable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    const file = writeInbox(root, 'stable.txt', directorTxt);
    const first = normalizeSourceFile(file);
    const second = normalizeSourceFile(file);
    eq('stable job IDs for the same source facts', first.job_id, second.job_id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeInbox(root, 'a.txt', directorTxt);
    writeInbox(root, 'b.txt', directorTxt.replace('director-ai', 'director-ai?utm_source=test'));
    const result = ingest({ root });
    eq('exact duplicate detection keeps one stored job', result.jobs_total, 1);
    ok('exact duplicate result reported', result.results.some((item) => item.deduplication_status === 'exact_duplicate'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    const one = normalizeSourceFile(writeInbox(root, 'one.txt', `# Principal AI Automation Architect at SimilarCo
Company: SimilarCo
Location: Remote United States
${'Own agentic automation architecture and workflow delivery. '.repeat(20)}
`));
    const two = normalizeSourceFile(writeInbox(root, 'two.txt', `# Principal AI Automation Architect at SimilarCo
Company: SimilarCo
Location: Remote United States
${'Own executive AI implementation, dashboards, and transformation. '.repeat(20)}
`));
    eq('likely duplicate detection', classifyDuplicate(two, [one]).status, 'likely_duplicate');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeInbox(root, 'old.txt', markdownJob);
    ingest({ root });
    writeInbox(root, 'new.txt', markdownJob.replace('https://jobs.example.test/beta/principal-ai-automation', 'https://jobs.example.test/beta/principal-ai-automation-repost'));
    const result = ingest({ root });
    ok('repost detection reported', result.results.some((item) => item.deduplication_status === 'repost'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeInbox(root, 'old.txt', directorTxt);
    ingest({ root });
    writeInbox(root, 'changed.txt', directorTxt.replace(longDescription, `${longDescription} New materially different scope with extra platform ownership. `.repeat(4)));
    const result = ingest({ root });
    ok('materially changed posting detected for same URL', result.results.some((item) => item.deduplication_status === 'materially_changed_posting'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeReport(root, 1, 'Acme AI', 'Director of AI', 4.6);
    writeReport(root, 2, 'Beta Systems', 'Principal AI Automation Architect', 4.1);
    writeInbox(root, 'acme.txt', directorTxt);
    writeInbox(root, 'beta.md', markdownJob);
    writeInbox(root, 'locked.md', mismatchJob);
    ingest({ root });
    const groups = shortlist({ root });
    eq('shortlist strong group has Acme', groups.strong[0].company, 'Acme AI');
    eq('shortlist good group has Beta', groups.good[0].company, 'Beta Systems');
    eq('shortlist reject group has mismatch', groups.reject[0].company, 'Locked Lab');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeInbox(root, 'director.txt', directorTxt);
    const result = ingest({ root });
    const id = result.results[0].job_id;
    for (const state of ['approve', 'reject', 'watch', 'research']) {
      const decision = decide(id, state, { root, actor: 'test', reason: `set ${state}` });
      eq(`decision ${state} recorded`, decision.state, state);
    }
    const audit = readFileSync(join(root, 'data', 'hawkeye', 'audit.jsonl'), 'utf-8').trim().split('\n');
    ok('append-only audit has ingest plus four decisions', audit.length >= 5);
    ok('approve audit note does not grant submission permission', audit.some((line) => line.includes('not approval to apply or submit')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeInbox(root, 'director.txt', directorTxt);
    const result = ingest({ root });
    let threw = false;
    try {
      decide(result.results[0].job_id, 'submit', { root });
    } catch {
      threw = true;
    }
    ok('invalid state transition rejected', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeInbox(root, 'director.txt', directorTxt);
    const beforeFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('network should not be called');
    };
    try {
      const result = ingest({ root });
      eq('no network calls during ingest', result.jobs_total, 1);
    } finally {
      globalThis.fetch = beforeFetch;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const result = await runCli(['apply']);
  eq('external application action fails closed', result.code, 2);
  ok('external action explains unsupported path', result.stderr.includes('fails closed'));
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    writeInbox(root, 'director.txt', directorTxt);
    const first = ingest({ root });
    const second = ingest({ root });
    eq('idempotent repeated ingestion keeps job count stable', second.jobs_total, first.jobs_total);
    eq('repeated ingestion reports duplicate', second.results[0].deduplication_status, 'exact_duplicate');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'success', 4.6);
    const result = evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    const job = getJob(id, { root });
    eq('successful evaluation handoff marks evaluation complete', result.evaluation.status, 'evaluation_complete');
    eq('canonical 1-5 score preserved after evaluation', job.evaluation.canonical_score, 4.6);
    eq('score scale remains 1-5', job.evaluation.score_scale, '1-5');
    eq('evidence preservation from Career Ops report', job.evaluation.strongest_evidence[0], 'Production AI automation programs');
    eq('evidence gap preservation from Career Ops report', job.evaluation.evidence_gaps[0], 'Enterprise governance metrics');
    eq('shortlist recomputes strong after canonical score', shortlist({ root }).strong[0].job_id, id);
    ok('evaluation report path attached', job.evaluation.report_path.endsWith('reports/099-syntheticco-2026-08-02.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'no-summary', 4.2);
    evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    const job = getJob(id, { root });
    eq('fallback parser attaches company from nested evaluation heading', job.evaluation.archetype, 'AI Transformation');
    eq('fallback parser attaches legitimacy from nested report body', job.evaluation.legitimacy, 'Proceed with Caution');
    eq('fallback parser preserves canonical score', job.evaluation.canonical_score, 4.2);
    ok('YAML wrapper excluded from strongest evidence', !job.evaluation.strongest_evidence.some((line) => line.includes('```') || line.includes('advertised_comp')));
    eq('evidence-section preference uses CV evidence table', job.evaluation.strongest_evidence[0], 'Built production AI automation workflows, operational dashboards, and API integrations for business teams.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'unsupported', 4.2);
    evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    const job = getJob(id, { root });
    eq('unsupported material claims require review state', job.evaluation.evaluation_status, 'evaluation_requires_review');
    eq('score trust downgraded when evidence is untrusted', job.evaluation.score_trust, 'requires_review');
    eq('canonical 1-5 score still preserved during review', job.evaluation.canonical_score, 4.2);
    ok('unsupported claims are recorded but not promoted as evidence', job.evaluation.claim_verification.unsupported.length > 0);
    ok('unsupported numeric claim excluded from strongest evidence', !job.evaluation.strongest_evidence.join('\n').includes('$1.2M'));
    eq('requires-review evaluation stays in watch shortlist group', shortlist({ root }).watch[0].job_id, id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'contradictory', 4.2);
    let threw = false;
    try {
      evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    } catch (err) {
      threw = err.message.includes('contradictory unsupported claims');
    }
    ok('contradictory career claim fails evaluation', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    writeProfile(root);
    const result = await runCli(['evaluate', 'missing-id'], root);
    eq('missing job ID fails closed', result.code, 1);
    ok('missing job ID error is clear', result.stderr.includes('Unknown Hawkeye job ID'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const job = getJob(id, { root });
    rmSync(join(root, job.evaluation.reference), { force: true });
    const fake = writeFakeEvaluator(root, 'success');
    let threw = false;
    try {
      evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    } catch (err) {
      threw = err.message.includes('JD file is missing');
    }
    ok('missing JD fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'failure');
    let threw = false;
    try {
      evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    } catch (err) {
      threw = err.message.includes('Career Ops evaluation failed');
    }
    ok('evaluator failure fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'unparseable');
    let threw = false;
    try {
      evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    } catch (err) {
      threw = err.message.includes('canonical 1-5 score');
    }
    ok('unparseable result fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'missing-score');
    let threw = false;
    try {
      evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    } catch (err) {
      threw = err.message.includes('canonical 1-5 score');
    }
    ok('missing score fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'conflict');
    let threw = false;
    try {
      evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    } catch (err) {
      threw = err.message.includes('conflicts with Hawkeye job company');
    }
    ok('conflicting evaluation fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'success', 4.7);
    const env = { NVIDIA_API_KEY: 'unit-test-nvidia-secret' };
    const result = evaluateJob(id, {
      root,
      env,
      hermesEnvPath: join(root, 'missing.env'),
      hermesConfigPath: join(root, 'missing.yaml'),
    });
    const job = getJob(id, { root });
    const observed = JSON.parse(readFileSync(join(root, 'provider-observed.json'), 'utf-8'));
    eq('NVIDIA provider selected by default', job.evaluation.evaluator_provider, 'nvidia-nim');
    eq('NVIDIA base URL host recorded without secret', job.evaluation.evaluator_base_url_hostname, 'integrate.api.nvidia.com');
    eq('NVIDIA model recorded', job.evaluation.evaluator_model, 'nvidia/llama-3.3-nemotron-super-49b-v1.5');
    eq('NVIDIA key inherited as OpenAI-compatible child key', observed.provider_key_expected, true);
    eq('canonical 1-5 score preserved for NVIDIA policy', result.evaluation.canonical_score, 4.7);
    eq('NVIDIA policy keeps paid fallback disabled', job.evaluation.evaluator_paid_allowed, false);
    ok('NVIDIA audit metadata contains no secret', !auditLines(root).join('\n').includes('unit-test-nvidia-secret'));
    ok('NVIDIA job record contains no secret', !JSON.stringify(job).includes('unit-test-nvidia-secret'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'success');
    let threw = false;
    try {
      evaluateJob(id, { root, env: {}, hermesEnvPath: join(root, 'missing.env'), hermesConfigPath: join(root, 'missing.yaml') });
    } catch (err) {
      threw = err.message.includes('NVIDIA_API_KEY is required');
    }
    ok('missing NVIDIA_API_KEY fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'success');
    let threw = false;
    try {
      evaluateJob(id, {
        root,
        env: { NVIDIA_API_KEY: 'unit-test-nvidia-secret' },
        provider: 'openai',
        hermesEnvPath: join(root, 'missing.env'),
        hermesConfigPath: join(root, 'missing.yaml'),
      });
    } catch (err) {
      threw = err.message.includes('not approved');
    }
    ok('unapproved provider fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'success');
    let threw = false;
    try {
      evaluateJob(id, {
        root,
        env: { NVIDIA_API_KEY: 'unit-test-nvidia-secret' },
        model: '',
        hermesEnvPath: join(root, 'missing.env'),
        hermesConfigPath: join(root, 'missing.yaml'),
      });
    } catch (err) {
      threw = err.message.includes('NVIDIA NIM model is required');
    }
    ok('missing NVIDIA model fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'success');
    let threw = false;
    try {
      evaluateJob(id, {
        root,
        env: { NVIDIA_API_KEY: 'unit-test-nvidia-secret' },
        baseUrl: 'https://api.openai.com/v1',
        hermesEnvPath: join(root, 'missing.env'),
        hermesConfigPath: join(root, 'missing.yaml'),
      });
    } catch (err) {
      threw = err.message.includes('Paid OpenAI fallback is blocked');
    }
    ok('api.openai.com fallback blocked', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'success');
    let threw = false;
    try {
      evaluateJob(id, {
        root,
        env: { NVIDIA_API_KEY: 'unit-test-nvidia-secret' },
        allowPaid: 'true',
        hermesEnvPath: join(root, 'missing.env'),
        hermesConfigPath: join(root, 'missing.yaml'),
      });
    } catch (err) {
      threw = err.message.includes('Paid fallback remains disabled');
    }
    ok('paid fallback request blocked', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'success');
    let threw = false;
    try {
      evaluateJob(id, {
        root,
        env: {
          NVIDIA_API_KEY: 'unit-test-nvidia-secret',
          CAREER_OPS_HAWKEYE_EVALUATOR: 'node openai-eval.mjs --file {jd}',
        },
        hermesEnvPath: join(root, 'missing.env'),
        hermesConfigPath: join(root, 'missing.yaml'),
      });
    } catch (err) {
      threw = err.message.includes('explicit approved --url');
    }
    ok('OpenAI-compatible evaluator without approved URL fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'invalid-score');
    let threw = false;
    try {
      evaluateJob(id, {
        root,
        env: { NVIDIA_API_KEY: 'unit-test-nvidia-secret' },
        hermesEnvPath: join(root, 'missing.env'),
        hermesConfigPath: join(root, 'missing.yaml'),
      });
    } catch (err) {
      threw = err.message.includes('canonical 1-5 score');
    }
    ok('invalid provider score fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'quota');
    let secretLeaked = false;
    let rateFailed = false;
    try {
      evaluateJob(id, {
        root,
        env: { NVIDIA_API_KEY: 'unit-test-nvidia-secret' },
        hermesEnvPath: join(root, 'missing.env'),
        hermesConfigPath: join(root, 'missing.yaml'),
      });
    } catch (err) {
      rateFailed = err.message.includes('Career Ops evaluation failed');
      secretLeaked = err.message.includes('unit-test-nvidia-secret');
    }
    ok('quota/rate-limit failure fails closed', rateFailed);
    eq('quota/rate-limit error redacts secret', secretLeaked, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    writeFakeOpenAiEvaluator(root, 'timeout');
    let threw = false;
    try {
      evaluateJob(id, {
        root,
        env: { NVIDIA_API_KEY: 'unit-test-nvidia-secret' },
        timeoutMs: 10,
        maxRetries: 0,
        hermesEnvPath: join(root, 'missing.env'),
        hermesConfigPath: join(root, 'missing.yaml'),
      });
    } catch (err) {
      threw = /timed out|ETIMEDOUT|SIGTERM/i.test(err.message);
    }
    ok('provider timeout fails closed', threw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'success', 4.6);
    evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    const before = auditLines(root).length;
    const second = evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    const after = auditLines(root).length;
    eq('idempotent reevaluation skips unchanged inputs', second.skipped, true);
    eq('idempotent reevaluation does not append duplicate audit', after, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'success', 4.6);
    evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    ingest({ root });
    eq('repeated ingestion preserves attached Career Ops score', getJob(id, { root }).evaluation.canonical_score, 4.6);
    eq('repeated ingestion preserves evaluated status', getJob(id, { root }).evaluation.status, 'evaluation_complete');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'success', 4.6);
    evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    const before = auditLines(root).length;
    const job = getJob(id, { root });
    writeFileSync(join(root, job.evaluation.reference), `${readFileSync(join(root, job.evaluation.reference), 'utf-8')}\nAdditional changed JD input.\n`, 'utf-8');
    const reevaluated = evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    const after = auditLines(root).length;
    eq('reevaluation after changed input is not skipped', reevaluated.skipped, false);
    ok('reevaluation after changed input appends audit', after === before + 1);
    ok('prior evaluation reference preserved', Boolean(getJob(id, { root }).evaluation.previous_evaluation_reference));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'success', 4.2);
    evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
    const job = getJob(id, { root });
    ok('no 0-100 conversion field is present', !('presentation_score' in job.evaluation) && !('score_100' in job.evaluation));
    ok('canonical score remains on 1-5 scale', job.evaluation.canonical_score <= 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const blockedPackage = await runCli(['evaluate', id, '--evaluator', 'node generate-pdf.mjs --file {jd}'], root);
    eq('package generation evaluator is blocked', blockedPackage.code, 1);
    ok('package generation blocked before execution', blockedPackage.stderr.includes('not allowed'));
    const blockedPortal = await runCli(['evaluate', id, '--evaluator', 'node browser-extract.mjs {jd}'], root);
    eq('browser/portal evaluator is blocked', blockedPortal.code, 1);
    ok('browser automation blocked before execution', blockedPortal.stderr.includes('not allowed'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = setupRoot();
  try {
    const id = ingestSynthetic(root);
    const fake = writeFakeEvaluator(root, 'success', 4.6);
    const beforeFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('network should not be called by Hawkeye bridge');
    };
    try {
      const result = evaluateJob(id, { root, evaluator: `${process.execPath} ${fake} --file {jd}` });
      eq('no network/Gmail/browser/portal access during synthetic evaluation bridge', result.ok, true);
    } finally {
      globalThis.fetch = beforeFetch;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\nhawkeye.test.mjs: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`Failures: ${failures.join(', ')}`);
  process.exit(1);
}
