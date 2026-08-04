#!/usr/bin/env node
/**
 * hawkeye-scout.mjs - Hawkeye-owned adapter from reverse ATS scan output into
 * the local Hawkeye ingest/evaluate/audit workflow.
 */

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';

const DEFAULT_DATA_DIR = 'data/hawkeye';
const DEFAULT_INBOX_DIR = 'data/hawkeye/inbox';
const DEFAULT_LIMIT = 15;
const DEFAULT_MIN_SCORE = 4.0;
const DEFAULT_SOURCES = ['greenhouse', 'lever', 'ashby', 'workday'];
const DISCOVERY_DAYS = 14;

const TARGET_TITLE_RE = /\b(?:director|head|vp|vice president|chief|principal|lead|leader|senior manager|manager)\b[\w\s/&,-]*(?:ai|artificial intelligence|applied ai|generative ai|genai|agentic|automation|transformation|strategy|operations)|\b(?:ai|artificial intelligence|applied ai|generative ai|genai|agentic)\b[\w\s/&,-]*\b(?:director|head|lead|leader|principal|strategy|operations|transformation)\b/i;
const JUNIOR_RE = /\b(?:junior|entry[-\s]?level|intern|internship|student|new grad|associate)\b/i;
const RESEARCH_ONLY_RE = /\b(?:research scientist|scientist, research|postdoc|postdoctoral|phd required|ph\.d\. required)\b/i;
const UNREALISTIC_RE = /\b(?:commission[-\s]?only|unpaid|volunteer)\b/i;
const PART_TIME_RE = /\b(?:part[-\s]?time|temporary|seasonal)\b/i;

function sha256(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function normalizeUrlForDedup(url) {
  try {
    const parsed = new URL(String(url));
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = '';
    const out = parsed.toString();
    return out.endsWith('/') ? out.slice(0, -1) : out;
  } catch {
    return String(url ?? '').trim();
  }
}

function normalizeKey(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeCompany(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slug(value) {
  return normalizeKey(value).replace(/\s+/g, '-').slice(0, 60) || 'role';
}

function asArray(value) {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function salaryValue(offer) {
  const value = offer.salary || offer.compensation || offer.pay || null;
  if (!value || typeof value !== 'object') return null;
  const min = Number(value.min ?? value.minimum ?? value.minimum_usd);
  const max = Number(value.max ?? value.maximum ?? value.maximum_usd ?? min);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return null;
  const low = Number.isFinite(min) ? min : max;
  const high = Number.isFinite(max) ? max : low;
  return {
    min: Math.min(low, high),
    max: Math.max(low, high),
    currency: String(value.currency || 'USD').toUpperCase(),
  };
}

function hasMinimumCompensation(offer, minimum = 75000) {
  const salary = salaryValue(offer);
  if (!salary) return true;
  return Number(salary.max ?? salary.min ?? 0) >= minimum;
}

function workArrangement(offer) {
  const text = `${offer.location || ''}\n${offer.description || ''}`.toLowerCase();
  if (/\bremote\b/.test(text)) return 'remote';
  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\bon[-\s]?site\b|\bin office\b/.test(text)) return 'on-site';
  return '';
}

function locationAllowed(offer, { location = '', remote = true } = {}) {
  const value = `${offer.location || ''} ${workArrangement(offer)}`.toLowerCase();
  if (!value.trim()) return true;
  if (remote && /\bremote\b/.test(value) && /\b(?:us|usa|united states|u\.s\.)\b/.test(value)) return true;
  if (remote && value.trim() === 'remote') return true;
  const allowed = [
    location,
    'new york',
    'nyc',
    'manhattan',
    'brooklyn',
    'new jersey',
    'nj',
    'northern nj',
    'jersey city',
    'hoboken',
    'newark',
  ].map((item) => String(item || '').toLowerCase()).filter(Boolean);
  return allowed.some((item) => value.includes(item));
}

function sourceFailureArray(payload) {
  const explicit = Array.isArray(payload?.sourceFailures) ? payload.sourceFailures : [];
  if (explicit.length) return explicit.map((item) => ({
    source: String(item.source || item.name || 'unknown'),
    reason: String(item.reason || item.error || 'source unavailable'),
  }));
  const count = Number(payload?.unreachableBoards || 0);
  return count > 0 ? [{ source: 'scanner', reason: `${count} unreachable board(s) skipped` }] : [];
}

function sourceUrlFromOffer(offer) {
  return normalizeUrlForDedup(offer.url || offer.source_url || offer.sourceUrl || '');
}

export function isSyntheticOffer(offer) {
  const values = [
    offer?.job_id,
    offer?.id,
    offer?.external_id,
    offer?.externalId,
    offer?.source,
    offer?.source_url,
    offer?.sourceUrl,
    offer?.url,
    offer?.company,
    offer?.type,
    offer?.schema_version,
  ].map((value) => String(value || '').toLowerCase());
  if (offer?.synthetic === true || offer?.fixture === true) return true;
  if (values.some((value) => value.includes('synthetic') || value.includes('fixture'))) return true;
  if (values.some((value) => /\b(?:example\.test|\.test\/|localhost|127\.0\.0\.1)\b/.test(value))) return true;
  return false;
}

function externalIdFromOffer(offer) {
  return String(offer.external_id || offer.externalId || offer.id || offer.req_id || offer.requisitionId || '').trim();
}

function existingIdentityKeys(existingJobs = []) {
  const sourceUrls = new Set();
  const externalIds = new Set();
  const companyTitleLocations = new Set();
  for (const job of existingJobs) {
    const url = normalizeUrlForDedup(job?.fields?.source_url?.value || job?.source_url || '');
    if (url) sourceUrls.add(url);
    const externalId = String(job?.external_id || job?.externalId || '').trim();
    if (externalId) externalIds.add(externalId);
    const company = normalizeCompany(job?.fields?.company?.value || job?.company || '');
    const title = normalizeKey(job?.fields?.title?.value || job?.title || '');
    const location = normalizeKey(job?.fields?.location?.value || job?.location || '');
    if (company && title && location) companyTitleLocations.add(`${company}|${title}|${location}`);
  }
  return { sourceUrls, externalIds, companyTitleLocations };
}

function offerIdentityKeys(offer) {
  const sourceUrl = sourceUrlFromOffer(offer);
  const externalId = externalIdFromOffer(offer);
  const companyTitleLocation = [
    normalizeCompany(offer.company || ''),
    normalizeKey(offer.title || ''),
    normalizeKey(offer.location || ''),
  ].join('|');
  return { sourceUrl, externalId, companyTitleLocation };
}

export function normalizeScannerOffer(offer, {
  discoveredDate = todayIso(),
  location = '',
  remote = true,
  minimumCompensation = 75000,
} = {}) {
  const sourceUrl = sourceUrlFromOffer(offer);
  const title = String(offer?.title || '').trim();
  const company = String(offer?.company || '').trim();
  const description = String(offer?.description || offer?.body || '').trim();
  const liveness = offer?.liveness || offer?.live || {};
  const livenessStatus = String(liveness.status || offer?.liveness_status || offer?.livenessStatus || 'unverified').toLowerCase();

  if (!title) return { ok: false, reason: 'malformed scanner result: missing title', offer };
  if (!company) return { ok: false, reason: 'malformed scanner result: missing company', offer };
  if (!sourceUrl) return { ok: false, reason: 'malformed scanner result: missing source URL', offer };
  if (['expired', 'dead', 'closed', 'inactive'].includes(livenessStatus)) {
    return { ok: false, reason: `posting ${livenessStatus}${liveness.reason ? `: ${liveness.reason}` : ''}`, offer };
  }

  const text = `${title}\n${description}`;
  if (!TARGET_TITLE_RE.test(title)) return { ok: false, reason: 'role title outside Hawkeye AI leadership target', offer };
  if (JUNIOR_RE.test(text)) return { ok: false, reason: 'junior or internship role excluded', offer };
  if (RESEARCH_ONLY_RE.test(text)) return { ok: false, reason: 'deeply research-only role excluded', offer };
  if (UNREALISTIC_RE.test(text)) return { ok: false, reason: 'unrealistic compensation/work model excluded', offer };
  if (PART_TIME_RE.test(offer.employmentType || offer.employment_type || '')) return { ok: false, reason: 'non-full-time role excluded', offer };
  if (!hasMinimumCompensation(offer, minimumCompensation)) return { ok: false, reason: `advertised compensation below ${minimumCompensation}`, offer };
  if (!locationAllowed(offer, { location, remote })) return { ok: false, reason: 'location outside Northern NJ / NYC metro / US remote target', offer };

  const salary = salaryValue(offer);
  const record = {
    schema_version: 'hawkeye-scout-source-v1',
    external_id: externalIdFromOffer(offer) || null,
    company,
    title,
    location: String(offer.location || '').trim(),
    work_arrangement: workArrangement(offer),
    compensation: salary,
    employment_type: offer.employmentType || offer.employment_type || 'Full-time',
    source: offer.source || 'scan-ats-full',
    source_url: sourceUrl,
    discovered_date: discoveredDate,
    closing_date: offer.closingDate || offer.closing_date || '',
    description: description || [
      `${title} at ${company}`,
      offer.location ? `Location: ${offer.location}` : '',
      salary ? `Compensation: ${salary.min}-${salary.max} ${salary.currency}` : '',
      'Description unavailable from scanner output; verify source page before applying.',
    ].filter(Boolean).join('\n'),
    required_qualifications: asArray(offer.requiredQualifications || offer.required_qualifications),
    preferred_qualifications: asArray(offer.preferredQualifications || offer.preferred_qualifications),
    liveness: {
      status: livenessStatus,
      reason: liveness.reason || offer.liveness_reason || '',
      checked_at: liveness.checked_at || liveness.checkedAt || '',
    },
    scanner: {
      source: offer.source || 'scan-ats-full',
      posted_at: offer.postedAt || null,
      date_status: offer.dateStatus || null,
      note: offer.note || null,
    },
  };
  return { ok: true, record };
}

export function suppressDuplicateScoutOffers(offers, existingJobs = []) {
  const keys = existingIdentityKeys(existingJobs);
  const kept = [];
  const duplicates = [];
  for (const offer of offers) {
    const offerKeys = offerIdentityKeys(offer);
    let reason = '';
    if (offerKeys.sourceUrl && keys.sourceUrls.has(offerKeys.sourceUrl)) reason = 'duplicate source URL';
    else if (offerKeys.externalId && keys.externalIds.has(offerKeys.externalId)) reason = 'duplicate external ID';
    else if (offerKeys.companyTitleLocation.replace(/\|/g, '') && keys.companyTitleLocations.has(offerKeys.companyTitleLocation)) reason = 'duplicate company/title/location';

    if (reason) {
      duplicates.push({ offer, reason });
      continue;
    }
    kept.push(offer);
    if (offerKeys.sourceUrl) keys.sourceUrls.add(offerKeys.sourceUrl);
    if (offerKeys.externalId) keys.externalIds.add(offerKeys.externalId);
    if (offerKeys.companyTitleLocation.replace(/\|/g, '')) keys.companyTitleLocations.add(offerKeys.companyTitleLocation);
  }
  return { kept, duplicates };
}

export function scoutPortalConfig({ location = 'Northern NJ / NYC metro', remote = true } = {}) {
  const locations = [
    'Remote',
    'Remote US',
    'United States',
    'New York',
    'NYC',
    'New Jersey',
    'Northern NJ',
    location,
  ].filter(Boolean);
  return [
    'title_filter:',
    '  positive:',
    '    - Director of AI',
    '    - Head of Applied AI',
    '    - Director of AI Engineering',
    '    - AI Transformation Director',
    '    - Generative AI Director',
    '    - Applied AI Lead',
    '    - AI Strategy',
    '    - AI Operations',
    '    - Agentic AI',
    '    - AI Automation',
    '  negative:',
    '    - Intern',
    '    - Internship',
    '    - Junior',
    '    - Entry Level',
    '    - Research Scientist',
    '    - Applied Scientist',
    'location_filter:',
    '  positive:',
    ...[...new Set(locations)].map((item) => `    - ${item}`),
    '  negative:',
    '    - India',
    '    - Europe',
    '    - Canada only',
    'content_filter:',
    '  positive:',
    '    - AI',
    '    - applied AI',
    '    - automation',
    '    - transformation',
    '    - strategy',
    '  negative:',
    '    - PhD required',
    '    - commission only',
    '    - part-time',
  ].join('\n') + '\n';
}

function loadExistingJobs(root, dataDir) {
  const path = resolve(root, dataDir, 'jobs.json');
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf-8')).jobs || [];
}

async function resolveHawkeyeDeps(deps = null) {
  if (deps?.ingest && deps?.evaluateJob && deps?.getJob) return deps;
  return import('./hawkeye.mjs');
}

function writeInboxRecord(root, inboxDir, record) {
  const hash = sha256(`${record.source_url}\n${record.external_id || ''}`).slice(0, 10);
  const filename = `${todayIso()}-${slug(record.company)}-${slug(record.title)}-${hash}.json`;
  const full = resolve(root, inboxDir, filename);
  ensureDir(dirname(full));
  writeFileSync(full, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  return { full, rel: `${inboxDir.replace(/\/$/, '')}/${filename}` };
}

function appendAudit(root, dataDir, event) {
  const auditPath = resolve(root, dataDir, 'audit.jsonl');
  ensureDir(dirname(auditPath));
  appendFileSync(auditPath, `${JSON.stringify({ timestamp: nowIso(), ...event })}\n`, 'utf-8');
}

function scannerCompanyLimit(resultLimit = DEFAULT_LIMIT) {
  const requested = Number(resultLimit);
  if (!Number.isFinite(requested) || requested <= 0) return 750;
  return Math.max(500, Math.min(2000, Math.ceil(requested * 50)));
}

function scannerArgs({ limit = DEFAULT_LIMIT, sources = DEFAULT_SOURCES, liveness = true } = {}) {
  // scan-ats-full.mjs --limit caps companies scanned per ATS source, not matched
  // jobs returned. Hawkeye's --limit is a result cap, so scan a broad enough
  // public company sample and apply the result cap after normalization.
  const args = ['scan-ats-full.mjs', '--json', '--dry-run', '--include-undated', '--since', String(DISCOVERY_DAYS), '--limit', String(scannerCompanyLimit(limit))];
  if (sources?.length) args.push('--ats', sources.join(','));
  if (liveness) args.push('--liveness');
  return args;
}

function runScannerProcess({ root, limit, sources, liveness, portalsPath }) {
  const stdout = execFileSync(process.execPath, scannerArgs({ limit, sources, liveness }), {
    cwd: root,
    encoding: 'utf-8',
    timeout: 600000,
    env: { ...process.env, CAREER_OPS_PORTALS: portalsPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

function defaultScanner({ root, limit, sources, location, remote, liveness = true } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'hawkeye-scout-portals-'));
  const portalsPath = join(temp, 'portals.yml');
  writeFileSync(portalsPath, scoutPortalConfig({ location, remote }), 'utf-8');
  try {
    return runScannerProcess({ root, limit, sources, liveness, portalsPath });
  } catch (err) {
    if (!liveness) throw err;
    const fallback = runScannerProcess({ root, limit, sources, liveness: false, portalsPath });
    return {
      ...fallback,
      sourceFailures: [
        ...sourceFailureArray(fallback),
        { source: 'liveness', reason: `liveness verification unavailable; continued without liveness (${err.message})` },
      ],
    };
  }
}

export function classifyScoutBucket(job, { minScore = DEFAULT_MIN_SCORE } = {}) {
  const evaluation = job?.evaluation || {};
  if (evaluation.hard_mismatches?.length) return 'Reject';
  if (evaluation.evaluation_status === 'evaluation_rejected_untrusted') return 'Reject';
  if (evaluation.evaluation_status === 'evaluation_requires_review') return 'Watch';
  const score = Number(evaluation.canonical_score);
  if (!Number.isFinite(score)) return 'Watch';
  if (score >= minScore) return 'Priority';
  if (score >= 3.5) return 'Watch';
  return 'Reject';
}

function summarizeJobs(jobs, { minScore = DEFAULT_MIN_SCORE } = {}) {
  const rows = jobs.map((job) => {
    const comp = job.fields?.compensation?.value;
    return {
      job_id: job.job_id,
      company: job.fields?.company?.value || 'unavailable',
      title: job.fields?.title?.value || 'unavailable',
      location: job.fields?.location?.value || 'unavailable',
      score: job.evaluation?.canonical_score ?? null,
      bucket: classifyScoutBucket(job, { minScore }),
      url: job.fields?.source_url?.value || '',
      compensation: comp ? `${comp.min}-${comp.max} ${comp.currency || 'USD'}` : 'unavailable',
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.company.localeCompare(b.company));
  const counts = { Priority: 0, Watch: 0, Reject: 0 };
  for (const row of rows) counts[row.bucket]++;
  return { counts, ranked: rows };
}

function makeRunId() {
  return `hawkeye-scout-${nowIso().replace(/[-:.]/g, '').slice(0, 15)}Z`;
}

function runStatusFor(result, failed = false) {
  if (failed) return 'failed';
  if (result.noEvaluate) return 'incomplete';
  if (result.evaluationErrors.length || result.sourceFailures.length) return 'partial';
  return 'complete';
}

function incompleteEvaluationsFor(result, jobIds = []) {
  if (result.noEvaluate) return jobIds.map((job_id) => ({ job_id, reason: 'evaluation skipped (--no-evaluate)' }));
  return result.evaluationErrors.map((item) => ({ job_id: item.job_id, reason: item.error }));
}

function appendScoutSummaryAudit(root, dataDir, result, {
  runId,
  actor,
  sources,
  status = null,
  jobIds = [],
} = {}) {
  const runStatus = status || runStatusFor(result);
  const incomplete = incompleteEvaluationsFor(result, jobIds);
  appendAudit(root, dataDir, {
    event: 'scout_summary',
    run_id: runId,
    actor,
    sources_attempted: sources,
    source_failures: result.sourceFailures,
    counts: {
      found: result.found,
      proposed: result.proposed.length,
      written: result.written.length,
      ingested: result.ingest.imported,
      deduplicated: result.deduped.length,
      evaluated: result.evaluated.length,
      Priority: result.summary.counts.Priority,
      Watch: result.summary.counts.Watch,
      Reject: result.summary.counts.Reject,
    },
    incomplete_evaluations: incomplete,
    run_status: runStatus,
  });
}

export function renderScoutSummary(result) {
  const lines = [
    '# Hawkeye Scout Summary',
    '',
    `Run: ${result.runId || 'unavailable'} | Status: ${result.runStatus || 'unavailable'}`,
    `Found: ${result.found} | Proposed: ${result.proposed.length} | Written: ${result.written.length} | Ingested: ${result.ingest.imported} | Deduped: ${result.deduped.length} | Rejected before ingest: ${result.rejected.length}`,
    `Evaluation: ${result.noEvaluate ? 'skipped (--no-evaluate)' : `${result.evaluated.length} complete, ${result.evaluationErrors.length} error(s)`}`,
    `Priority: ${result.summary.counts.Priority} | Watch: ${result.summary.counts.Watch} | Reject: ${result.summary.counts.Reject}`,
  ];
  if (result.syntheticFiltered?.length) {
    lines.push(`Synthetic filtered: ${result.syntheticFiltered.length}`);
  }
  if (result.sourceFailures.length) {
    lines.push('', 'Source failures:');
    for (const failure of result.sourceFailures) lines.push(`- ${failure.source}: ${failure.reason}`);
  }
  if (result.summary.ranked.length) {
    lines.push('', 'Top roles:');
    for (const row of result.summary.ranked.slice(0, 10)) {
      lines.push(`- ${row.bucket} ${row.score == null ? 'n/a' : `${row.score}/5`} - ${row.company} - ${row.title} (${row.location})`);
      lines.push(`  ${row.url}`);
    }
  } else if (result.proposed.length) {
    lines.push('', 'Proposed files:');
    for (const item of result.proposed.slice(0, 10)) lines.push(`- ${item.company} - ${item.title} -> ${item.filename}`);
  }
  return lines.join('\n');
}

export async function runHawkeyeScout({
  root = process.cwd(),
  dataDir = DEFAULT_DATA_DIR,
  inboxDir = DEFAULT_INBOX_DIR,
  limit = DEFAULT_LIMIT,
  location = 'Northern NJ / NYC metro',
  remote = true,
  minScore = DEFAULT_MIN_SCORE,
  sources = DEFAULT_SOURCES,
  dryRun = false,
  noEvaluate = false,
  scanner = null,
  evaluator = null,
  liveness = true,
  includeSynthetic = false,
  actor = 'hawkeye-scout',
  hawkeye = null,
} = {}) {
  const runId = makeRunId();
  const hawkeyeDeps = await resolveHawkeyeDeps(hawkeye);
  let sourcePayload;
  try {
    sourcePayload = scanner
      ? await scanner({ root, limit, sources, location, remote, liveness })
      : await defaultScanner({ root, limit, sources, location, remote, liveness });
  } catch (err) {
    const failed = {
      ok: false,
      dryRun,
      noEvaluate,
      runId,
      runStatus: 'failed',
      found: 0,
      sourceFailures: [{ source: 'scanner', reason: err.message || String(err) }],
      syntheticFiltered: [],
      deduped: [],
      rejected: [],
      proposed: [],
      written: [],
      ingest: { files_read: 0, imported: 0, jobs_total: loadExistingJobs(root, dataDir).length, results: [] },
      evaluated: [],
      evaluationErrors: [],
      summary: { counts: { Priority: 0, Watch: 0, Reject: 0 }, ranked: [] },
    };
    if (!dryRun) appendScoutSummaryAudit(root, dataDir, failed, { runId, actor, sources, status: 'failed' });
    throw err;
  }
  const allOffers = Array.isArray(sourcePayload?.offers) ? sourcePayload.offers : [];
  const syntheticFiltered = includeSynthetic ? [] : allOffers.filter(isSyntheticOffer);
  const offers = includeSynthetic ? allOffers : allOffers.filter((offer) => !isSyntheticOffer(offer));
  const sourceFailures = sourceFailureArray(sourcePayload);
  const existingJobs = loadExistingJobs(root, dataDir);
  const dedup = suppressDuplicateScoutOffers(offers, existingJobs);
  const normalized = [];
  const rejected = [];
  for (const offer of dedup.kept) {
    const result = normalizeScannerOffer(offer, { discoveredDate: sourcePayload?.date || todayIso(), location, remote });
    if (result.ok) normalized.push(result.record);
    else rejected.push({ offer, reason: result.reason });
  }
  const cappedNormalized = normalized.slice(0, Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT);
  const proposed = cappedNormalized.map((record) => ({
    company: record.company,
    title: record.title,
    source_url: record.source_url,
    filename: `${todayIso()}-${slug(record.company)}-${slug(record.title)}-${sha256(`${record.source_url}\n${record.external_id || ''}`).slice(0, 10)}.json`,
  }));
  const base = {
    ok: true,
    dryRun,
    noEvaluate,
    runId,
    runStatus: 'pending',
    found: allOffers.length,
    sourceFailures,
    syntheticFiltered,
    deduped: dedup.duplicates,
    rejected,
    proposed,
    written: [],
    ingest: { files_read: 0, imported: 0, jobs_total: existingJobs.length, results: [] },
    evaluated: [],
    evaluationErrors: [],
    summary: { counts: { Priority: 0, Watch: 0, Reject: 0 }, ranked: [] },
  };
  if (dryRun) return base;

  if (cappedNormalized.length === 0) {
    appendAudit(root, dataDir, {
      event: 'scout',
      actor,
      sources,
      found: base.found,
      proposed: 0,
      written: 0,
      imported: 0,
      deduped: base.deduped.length,
      rejected: base.rejected.length,
      evaluated: 0,
      evaluation_errors: 0,
      priority: 0,
      watch: 0,
      reject: 0,
      source_failures: sourceFailures,
    });
    const noJobsResult = { ...base, runStatus: runStatusFor(base) };
    appendScoutSummaryAudit(root, dataDir, noJobsResult, { runId, actor, sources, jobIds: [] });
    return noJobsResult;
  }

  const written = cappedNormalized.map((record) => writeInboxRecord(root, inboxDir, record));
  const ingestResult = hawkeyeDeps.ingest({ root, dataDir, inboxDir, actor });
  const writtenSources = new Set(written.map((item) => item.rel));
  const touchedResults = ingestResult.results.filter((item) => writtenSources.has(item.source_file));
  const importedCount = touchedResults.filter((item) => item.imported).length;
  const jobIds = [...new Set(touchedResults.map((item) => item.job_id))];
  const evaluated = [];
  const evaluationErrors = [];
  if (!noEvaluate) {
    for (const jobId of jobIds) {
      try {
        const result = hawkeyeDeps.evaluateJob(jobId, { root, dataDir, evaluator, actor });
        evaluated.push(result);
      } catch (err) {
        evaluationErrors.push({ job_id: jobId, error: err.message || String(err) });
      }
    }
  }
  const jobs = jobIds.map((jobId) => hawkeyeDeps.getJob(jobId, { root, dataDir })).filter(Boolean);
  const summary = summarizeJobs(jobs, { minScore });
  const result = {
    ...base,
    written,
    ingest: { ...ingestResult, imported: importedCount, results: touchedResults },
    evaluated,
    evaluationErrors,
    summary,
  };
  result.runStatus = runStatusFor(result);
  appendAudit(root, dataDir, {
    event: 'scout',
    actor,
    sources,
    found: result.found,
    proposed: result.proposed.length,
    written: result.written.length,
    imported: result.ingest.imported,
    deduped: result.deduped.length,
    rejected: result.rejected.length,
    evaluated: result.evaluated.length,
    evaluation_errors: result.evaluationErrors.length,
    priority: result.summary.counts.Priority,
    watch: result.summary.counts.Watch,
    reject: result.summary.counts.Reject,
    source_failures: sourceFailures,
  });
  appendScoutSummaryAudit(root, dataDir, result, { runId, actor, sources, jobIds });
  return result;
}
