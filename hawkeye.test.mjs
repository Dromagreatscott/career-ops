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
  getJob,
  ingest,
  normalizeSourceFile,
  runCli,
  shortlist,
} from './hawkeye.mjs';

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
Built production AI automation workflows, operational dashboards, and API integrations for business teams.
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

console.log(`\nhawkeye.test.mjs: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`Failures: ${failures.join(', ')}`);
  process.exit(1);
}
