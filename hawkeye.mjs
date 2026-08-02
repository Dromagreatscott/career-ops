#!/usr/bin/env node
/**
 * hawkeye.mjs - local scouting/orchestration MVP for Career Ops.
 *
 * Hawkeye imports approved local job descriptions, normalizes and deduplicates
 * them, links existing Career Ops 1-5 evaluations when available, and records
 * local human decisions. It never searches the web, opens portals, sends email,
 * generates application packages, or submits applications.
 */

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, extname, join, relative, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { fingerprintText, similarity } from './fingerprint-core.mjs';
import { classifyTier } from './classify-tier.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { extractJdSkills, classifySkillGaps } from './jd-skill-gap.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = 'data/hawkeye';
const DEFAULT_INBOX_DIR = 'data/hawkeye/inbox';
const JOBS_FILE = 'jobs.json';
const AUDIT_FILE = 'audit.jsonl';
const JDS_DIR = 'jds';
const DEFAULT_PROVIDER = 'nvidia-nim';
const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_NVIDIA_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1.5';
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_MAX_RETRIES = 1;
const DECISIONS = new Set(['approve', 'reject', 'watch', 'research']);
const UNAVAILABLE = 'unavailable';
const EXTRACTED = 'extracted';
const INFERRED = 'inferred from explicit wording';
const SCHEMA_VERSION = 'hawkeye-scouting-v1';
const FORBIDDEN_COMMANDS = new Set([
  'apply',
  'submit',
  'send',
  'email',
  'gmail',
  'portal',
  'package',
  'generate',
]);

function usage() {
  return `Usage:
  node hawkeye.mjs ingest [--inbox <dir>] [--data-dir <dir>] [--actor <name>]
  node hawkeye.mjs evaluate <job-id> [--evaluator <command-template>] [--provider nvidia-nim] [--model <id>] [--base-url <url>] [--force] [--data-dir <dir>]
  node hawkeye.mjs shortlist [--data-dir <dir>]
  node hawkeye.mjs show <job-id> [--data-dir <dir>]
  node hawkeye.mjs decide <job-id> <approve|reject|watch|research> [--reason <text>] [--actor <name>] [--data-dir <dir>]

Safety:
  Hawkeye MVP is local-only. It does not search live jobs, open browsers,
  generate packages, send email, create Gmail drafts, contact recruiters,
  upload resumes, or submit applications.`;
}

function sha256(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[ \u00a0]+$/gm, '')
    .trim();
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

function normalizeCompany(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sanitizeMarkdownField(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s*\|\s*/g, ' / ').trim();
}

function formatCompensation(salary) {
  if (!salary || typeof salary !== 'object') return '';
  const min = Number(salary.min ?? salary.minimum ?? salary.minimum_usd);
  const max = Number(salary.max ?? salary.maximum ?? salary.maximum_usd);
  const currency = String(salary.currency || '').trim();
  if (Number.isFinite(min) && Number.isFinite(max) && min !== max) return `${min}-${max}${currency ? ` ${currency}` : ''}`;
  const single = Number.isFinite(min) ? min : Number.isFinite(max) ? max : null;
  return single == null ? '' : `${single}${currency ? ` ${currency}` : ''}`;
}

function buildSalaryFilter({ min = 0, max = 0, currency = '' } = {}) {
  const low = Number(min || 0);
  const high = Number(max || 0);
  const expectedCurrency = String(currency || '').toUpperCase();
  return (salary) => {
    if (!salary) return true;
    const jobMin = salary.min ?? salary.max ?? null;
    const jobMax = salary.max ?? salary.min ?? null;
    if (jobMin == null && jobMax == null) return true;
    const jobCurrency = String(salary.currency || '').toUpperCase();
    if (expectedCurrency && jobCurrency && expectedCurrency !== jobCurrency) return false;
    if (low > 0 && jobMax != null && jobMax < low) return false;
    if (high > 0 && jobMin != null && jobMin > high) return false;
    return true;
  };
}

function buildLocationFilter({ always_allow = [], allow = [], block = [] } = {}) {
  const norm = (items) => items.map((item) => String(item).toLowerCase()).filter(Boolean);
  const always = norm(always_allow);
  const allowed = norm(allow);
  const blocked = norm(block);
  return (location) => {
    const value = String(location || '').toLowerCase();
    if (!value.trim()) return true;
    if (always.some((item) => value.includes(item))) return true;
    if (blocked.some((item) => value.includes(item))) return false;
    if (allowed.length === 0) return true;
    return allowed.some((item) => value.includes(item.toLowerCase()) || item.toLowerCase().includes(value));
  };
}

function field(value, status = EXTRACTED, evidence = []) {
  const cleaned = typeof value === 'string' ? value.trim() : value;
  const missing = cleaned == null || cleaned === '';
  return {
    value: missing ? null : cleaned,
    status: missing ? UNAVAILABLE : status,
    evidence: missing ? [] : evidence.filter(Boolean),
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--')) {
      const [flag, inline] = arg.split('=', 2);
      const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
      else out[key] = true;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function appendAudit(root, dataDir, event) {
  const auditPath = resolve(root, dataDir, AUDIT_FILE);
  ensureDir(dirname(auditPath));
  appendFileSync(auditPath, `${JSON.stringify({ timestamp: nowIso(), ...event })}\n`, 'utf-8');
}

function listSourceFiles(root, inboxDir) {
  const full = resolve(root, inboxDir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => ['.txt', '.md', '.json'].includes(extname(name).toLowerCase()))
    .map((name) => resolve(full, name))
    .filter((path) => statSync(path).isFile())
    .sort();
}

function labeledValue(text, labels) {
  const label = labels.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = String(text).match(new RegExp(`^(?:\\*\\*)?(?:${label})(?:\\*\\*)?\\s*:?\\s*(.+)$`, 'im'));
  return match?.[1]?.replace(/^[-:]\s*/, '').trim() ?? '';
}

function firstHeading(text) {
  return String(text).match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
}

function titleCompanyFromHeading(heading) {
  const at = heading.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (at) return { title: at[1].trim(), company: at[2].trim() };
  const dash = heading.match(/^(.+?)\s+[-|]\s+(.+)$/);
  if (dash) return { company: dash[1].trim(), title: dash[2].trim() };
  return { title: heading.trim(), company: '' };
}

function parseSections(text) {
  const sections = new Map();
  let current = 'general';
  sections.set(current, []);
  for (const raw of String(text).split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/)?.[1]
      || trimmed.match(/^([A-Z][A-Za-z /&-]{2,}):$/)?.[1];
    if (heading) {
      current = heading.toLowerCase();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current).push(trimmed.replace(/^[-*]\s+/, ''));
  }
  return sections;
}

function sectionItems(sections, patterns) {
  const items = [];
  for (const [name, lines] of sections.entries()) {
    if (patterns.some((pattern) => pattern.test(name))) items.push(...lines);
  }
  return items;
}

function extractWorkArrangement(text, location = '') {
  const joined = `${text}\n${location}`.toLowerCase();
  if (/\bremote\b/.test(joined)) return field('remote', INFERRED, ['explicit remote wording']);
  if (/\bhybrid\b/.test(joined)) return field('hybrid', INFERRED, ['explicit hybrid wording']);
  if (/\bon[- ]?site\b|\bin office\b/.test(joined)) return field('on-site', INFERRED, ['explicit on-site wording']);
  return field(null);
}

function parseCompensationText(text) {
  const match = String(text).match(/\$?\s*(\d{2,3}(?:,\d{3})+|\d{6,})(?:\s*(?:-|to|–|—)\s*\$?\s*(\d{2,3}(?:,\d{3})+|\d{6,}))?\s*(USD|usd)?/);
  if (!match) return null;
  const min = Number(match[1].replace(/,/g, ''));
  const max = match[2] ? Number(match[2].replace(/,/g, '')) : min;
  return { min: Math.min(min, max), max: Math.max(min, max), currency: 'USD', raw: match[0].trim() };
}

function normalizeCompensation(value, fullText = '') {
  if (value && typeof value === 'object') {
    const min = Number(value.min ?? value.minimum ?? value.minimum_usd);
    const max = Number(value.max ?? value.maximum ?? value.maximum_usd ?? min);
    if (Number.isFinite(min) || Number.isFinite(max)) {
      const lo = Number.isFinite(min) ? min : max;
      const hi = Number.isFinite(max) ? max : lo;
      return field({ min: Math.min(lo, hi), max: Math.max(lo, hi), currency: value.currency || 'USD', raw: value.raw || '' }, EXTRACTED, ['explicit JSON compensation']);
    }
  }
  const text = typeof value === 'string' && value.trim() ? value : fullText;
  const parsed = parseCompensationText(text);
  return parsed ? field(parsed, EXTRACTED, ['explicit compensation wording']) : field(null);
}

function extractClosingDate(text) {
  const value = labeledValue(text, ['Closing Date', 'Closes', 'Application Deadline']);
  return value || String(text).match(/\b(?:closing date|closes|deadline)\s*:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || '';
}

function normalizeFromText(rawText, sourcePath) {
  const text = normalizeWhitespace(rawText);
  const sections = parseSections(text);
  const headingParts = titleCompanyFromHeading(firstHeading(text));
  const company = labeledValue(text, ['Company', 'Organization', 'Employer']) || headingParts.company;
  const title = labeledValue(text, ['Role Title', 'Title', 'Position', 'Job Title']) || headingParts.title;
  const location = labeledValue(text, ['Location', 'Job Location', 'Work Location']);
  const sourceUrl = labeledValue(text, ['Source URL', 'Source', 'URL']) || text.match(/https?:\/\/[^\s)]+/)?.[0] || '';

  return makeNormalizedJob({
    company,
    title,
    location,
    workArrangement: extractWorkArrangement(text, location).value,
    compensation: normalizeCompensation('', text).value,
    employmentType: text.match(/\b(full[- ]time|part[- ]time|contract|temporary|internship)\b/i)?.[0] || '',
    source: `local:${basename(sourcePath)}`,
    sourceUrl,
    discoveredDate: labeledValue(text, ['Discovered Date', 'Discovered']) || todayIso(),
    description: text,
    closingDate: extractClosingDate(text),
    requiredQualifications: sectionItems(sections, [/required/, /minimum qualification/, /must have/, /basic qualification/]),
    preferredQualifications: sectionItems(sections, [/preferred/, /nice to have/, /bonus/]),
    sourcePath,
  });
}

function normalizeFromJson(rawText, sourcePath) {
  const parsed = JSON.parse(rawText);
  const description = normalizeWhitespace(parsed.description || parsed.job_description || parsed.body || '');
  return makeNormalizedJob({
    company: parsed.company,
    title: parsed.title || parsed.role_title || parsed.role,
    location: parsed.location,
    workArrangement: parsed.work_arrangement || parsed.workArrangement,
    compensation: normalizeCompensation(parsed.compensation, description).value,
    employmentType: parsed.employment_type || parsed.employmentType,
    source: parsed.source || `local:${basename(sourcePath)}`,
    sourceUrl: parsed.source_url || parsed.sourceUrl || parsed.url,
    discoveredDate: parsed.discovered_date || parsed.discoveredDate || todayIso(),
    description,
    closingDate: parsed.closing_date || parsed.closingDate,
    requiredQualifications: arrayValue(parsed.required_qualifications || parsed.requiredQualifications),
    preferredQualifications: arrayValue(parsed.preferred_qualifications || parsed.preferredQualifications),
    sourcePath,
  });
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function makeNormalizedJob(input) {
  const description = normalizeWhitespace(input.description || '');
  const fingerprint = fingerprintText(description);
  const urlKey = input.sourceUrl ? normalizeUrlForDedup(input.sourceUrl) : '';
  const identity = urlKey || [
    input.company || '',
    input.title || '',
    input.location || '',
    fingerprint || sha256(description).slice(0, 16),
  ].join('|');
  const jobId = `hwk_${sha256(identity).slice(0, 12)}`;
  return {
    schema_version: SCHEMA_VERSION,
    job_id: jobId,
    fields: {
      company: field(input.company, EXTRACTED, ['local source']),
      title: field(input.title, EXTRACTED, ['local source']),
      location: field(input.location, EXTRACTED, ['local source']),
      work_arrangement: field(input.workArrangement, input.workArrangement ? INFERRED : EXTRACTED, ['explicit local wording']),
      compensation: input.compensation ? field(input.compensation, EXTRACTED, ['local source']) : field(null),
      employment_type: field(input.employmentType, EXTRACTED, ['local source']),
      source: field(input.source, EXTRACTED, ['local source adapter']),
      source_url: field(input.sourceUrl, EXTRACTED, ['local source']),
      discovered_date: field(input.discoveredDate || todayIso(), EXTRACTED, ['local source adapter']),
      closing_date: field(input.closingDate, EXTRACTED, ['local source']),
    },
    required_qualifications: arrayValue(input.requiredQualifications),
    preferred_qualifications: arrayValue(input.preferredQualifications),
    description,
    fingerprint,
    source_file: input.sourcePath,
    source_sha256: existsSync(input.sourcePath) ? sha256(readFileSync(input.sourcePath, 'utf-8')) : '',
  };
}

export function normalizeSourceFile(sourcePath) {
  const ext = extname(sourcePath).toLowerCase();
  const raw = readFileSync(sourcePath, 'utf-8');
  if (ext === '.json') return normalizeFromJson(raw, sourcePath);
  if (ext === '.txt' || ext === '.md') return normalizeFromText(raw, sourcePath);
  throw new Error(`Unsupported inbox file type: ${sourcePath}`);
}

function loadState(root, dataDir) {
  const path = resolve(root, dataDir, JOBS_FILE);
  return readJson(path, { schema_version: SCHEMA_VERSION, jobs: [] });
}

function saveState(root, dataDir, state) {
  writeJson(resolve(root, dataDir, JOBS_FILE), state);
}

function writeJobDescription(root, dataDir, job) {
  const relPath = join(dataDir, JDS_DIR, `${job.job_id}.md`);
  const fullPath = resolve(root, relPath);
  ensureDir(dirname(fullPath));
  const lines = [
    `# ${job.fields.title.value || 'Untitled role'}${job.fields.company.value ? ` at ${job.fields.company.value}` : ''}`,
    '',
    `Source file: ${relative(root, job.source_file)}`,
    job.fields.source_url.value ? `Source URL: ${job.fields.source_url.value}` : '',
    '',
    job.description,
  ].filter((line) => line !== '');
  writeFileSync(fullPath, `${lines.join('\n')}\n`, 'utf-8');
  return relPath;
}

function sameCompany(a, b) {
  return normalizeCompany(a || '') === normalizeCompany(b || '');
}

function sameLocation(a, b) {
  const left = String(a || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const right = String(b || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return left && right && left === right;
}

function compareJobs(candidate, existing) {
  const cUrl = candidate.fields.source_url.value ? normalizeUrlForDedup(candidate.fields.source_url.value) : '';
  const eUrl = existing.fields.source_url.value ? normalizeUrlForDedup(existing.fields.source_url.value) : '';
  const cCompany = candidate.fields.company.value || '';
  const eCompany = existing.fields.company.value || '';
  const cTitle = candidate.fields.title.value || '';
  const eTitle = existing.fields.title.value || '';
  const cLoc = candidate.fields.location.value || '';
  const eLoc = existing.fields.location.value || '';
  const fpSimilarity = similarity(candidate.fingerprint, existing.fingerprint);

  if (cUrl && eUrl && cUrl === eUrl) {
    if (candidate.fingerprint && existing.fingerprint && candidate.fingerprint !== existing.fingerprint) {
      return { status: 'materially_changed_posting', evidence: 'same canonical URL with changed description fingerprint' };
    }
    return { status: 'exact_duplicate', evidence: 'same canonical URL' };
  }
  if (sameCompany(cCompany, eCompany) && roleFuzzyMatch(cTitle, eTitle) && cUrl && eUrl && cUrl !== eUrl) {
    return { status: 'repost', evidence: 'same company and fuzzy role with a different URL' };
  }
  if (candidate.fingerprint && candidate.fingerprint === existing.fingerprint && sameCompany(cCompany, eCompany) && roleFuzzyMatch(cTitle, eTitle)) {
    return { status: 'exact_duplicate', evidence: 'same company, fuzzy role, and description fingerprint' };
  }
  if ((sameCompany(cCompany, eCompany) && roleFuzzyMatch(cTitle, eTitle) && sameLocation(cLoc, eLoc)) || fpSimilarity >= 0.92) {
    return { status: 'likely_duplicate', evidence: fpSimilarity >= 0.92 ? `description similarity ${fpSimilarity.toFixed(2)}` : 'same company, fuzzy role, and location' };
  }
  return null;
}

export function classifyDuplicate(candidate, existingJobs) {
  const matches = existingJobs
    .map((job) => ({ job, match: compareJobs(candidate, job) }))
    .filter((item) => item.match);
  if (matches.length === 0) return { status: 'new_posting', matches: [] };
  const order = ['exact_duplicate', 'materially_changed_posting', 'repost', 'likely_duplicate'];
  matches.sort((a, b) => order.indexOf(a.match.status) - order.indexOf(b.match.status));
  return {
    status: matches[0].match.status,
    matches: matches.map(({ job, match }) => ({
      job_id: job.job_id,
      company: job.fields.company.value,
      title: job.fields.title.value,
      evidence: match.evidence,
      status: match.status,
    })),
  };
}

function loadProfile(root) {
  const path = resolve(root, 'config/profile.yml');
  if (!existsSync(path)) return {};
  return parseProfileYaml(readFileSync(path, 'utf-8'));
}

function parseTopLevelList(text, key) {
  const re = new RegExp(`^${key}:\\n((?:\\s{2}-\\s+.+\\n?)+)`, 'm');
  const block = String(text).match(re)?.[1] || '';
  return [...block.matchAll(/^  -\s+(.+)$/gm)].map((m) => stripQuotes(m[1].trim()));
}

function parseNestedList(text, parent, key) {
  const parentBlock = blockAfter(text, parent, 0);
  const re = new RegExp(`^\\s{2}${key}:\\n((?:\\s{4}-\\s+.+\\n?)+)`, 'm');
  const block = parentBlock.match(re)?.[1] || '';
  return [...block.matchAll(/^    -\s+(.+)$/gm)].map((m) => stripQuotes(m[1].trim()));
}

function parseNestedNumber(text, parent, key) {
  const parentBlock = blockAfter(text, parent, 0);
  const match = parentBlock.match(new RegExp(`^\\s{2}${key}:\\s+(\\d+)\\s*$`, 'm'));
  return match ? Number(match[1]) : null;
}

function blockAfter(text, key, indent = 0) {
  const prefix = ' '.repeat(indent);
  const re = new RegExp(`^${prefix}${key}:\\n([\\s\\S]*?)(?=^[^\\s#][\\w_-]*:|(?![\\s\\S]))`, 'm');
  return String(text).match(re)?.[1] || '';
}

function parseProfileYaml(text) {
  return {
    target_roles: parseTopLevelList(text, 'target_roles'),
    targets: {
      roles: parseNestedList(text, 'targets', 'roles'),
      locations: parseNestedList(text, 'targets', 'locations'),
    },
    location: {
      preferred: parseNestedList(text, 'location', 'preferred'),
    },
    compensation: {
      minimum_base: parseNestedNumber(text, 'compensation', 'minimum_base'),
      min_base: parseNestedNumber(text, 'compensation', 'min_base'),
    },
  };
}

function loadCv(root) {
  const path = resolve(root, 'cv.md');
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function compensationResult(job, profile) {
  const comp = job.fields.compensation.value;
  if (!comp) return { status: 'unknown', detail: 'Compensation unavailable; do not guess.' };
  const target = profile?.compensation?.minimum_base
    || profile?.compensation?.min_base
    || profile?.targets?.compensation?.minimum_base_usd
    || 175000;
  const salaryFilter = buildSalaryFilter({ min: Number(target), currency: 'USD' });
  const pass = salaryFilter(comp);
  return {
    status: pass ? 'pass' : 'mismatch',
    detail: pass ? `Advertised compensation overlaps minimum ${target}.` : `Advertised compensation appears below minimum ${target}.`,
    formatted: formatCompensation(comp),
  };
}

function locationResult(job, profile) {
  const location = job.fields.location.value || '';
  const arrangement = job.fields.work_arrangement.value || '';
  if (!location && !arrangement) return { status: 'unknown', detail: 'Location/work arrangement unavailable; do not guess.' };
  const preferred = [
    ...(profile?.location?.preferred || []),
    ...(profile?.targets?.locations || []),
  ].map(String);
  const allow = preferred.length ? preferred : ['Remote', 'United States', 'New York', 'New Jersey', 'NJ', 'NYC'];
  const locationFilter = buildLocationFilter({ always_allow: ['remote'], allow, block: [] });
  const pass = locationFilter(`${location} ${arrangement}`);
  return {
    status: pass ? 'pass' : 'review',
    detail: pass ? 'Location/work arrangement matches configured preferences or remote allowance.' : 'Location needs human review against configured preferences.',
  };
}

function roleAlignment(job, profile) {
  const title = String(job.fields.title.value || '').toLowerCase();
  const roles = [
    ...(profile?.target_roles || []),
    ...(profile?.targets?.roles || []),
  ].map(String);
  const exact = roles.find((role) => title.includes(role.toLowerCase()));
  if (exact) return { status: 'target', detail: `Title matches target role: ${exact}` };
  if (/\b(director|head|vp|chief|principal|architect|leader|manager)\b/i.test(title) && /\b(ai|applied|agentic|automation|transformation)\b/i.test(title)) {
    return { status: 'aligned', detail: 'Title matches senior applied-AI target pattern.' };
  }
  return { status: 'review', detail: 'Role alignment needs Career Ops evaluation.' };
}

function parseReportSummary(content, file, root = ROOT) {
  const machine = content.match(/##\s*Machine Summary\s*\n+```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/i)?.[1] || '';
  const doc = parseSimpleYamlScalars(machine);
  const scoreText = content.match(/\*\*Score:\*\*\s*([0-9]+(?:\.[0-9]+)?)\/5/i)?.[1]
    || content.match(/^\s*score:\s*([0-9]+(?:\.[0-9]+)?)/im)?.[1];
  const company = doc.company || content.match(/\*\*Company:\*\*\s*(.+)$/im)?.[1] || '';
  const role = doc.role || content.match(/\*\*Role:\*\*\s*(.+)$/im)?.[1] || '';
  const score = scoreText ? Number(scoreText) : null;
  if (!Number.isFinite(score)) return null;
  return {
    company: String(company).trim(),
    role: String(role).trim(),
    score,
    reference: relative(root, file),
    advertised_comp: doc.advertised_comp ?? null,
  };
}

function scoreFromText(text) {
  const summary = String(text || '').match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
  const summaryScore = summary?.[1]?.match(/^\s*SCORE:\s*([0-9]+(?:\.[0-9]+)?)\s*$/im)?.[1];
  const scoreText = summaryScore
    || String(text || '').match(/\*\*Score:\*\*\s*([0-9]+(?:\.[0-9]+)?)\/5/i)?.[1]
    || String(text || '').match(/^\s*score:\s*([0-9]+(?:\.[0-9]+)?)/im)?.[1];
  const score = scoreText == null ? null : Number(scoreText);
  return Number.isFinite(score) && score >= 0 && score <= 5 ? score : null;
}

function fieldFromScoreSummary(text, key) {
  const summary = String(text || '').match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
  const match = summary?.[1]?.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'im'));
  return match ? match[1].trim() : '';
}

function firstReportPathFromOutput(output) {
  const match = String(output || '').match(/\breports\/[A-Za-z0-9._/-]+\.md\b/);
  return match ? match[0] : '';
}

function reportSnapshot(root) {
  const reportsDir = resolve(root, 'reports');
  const snapshot = new Map();
  if (!existsSync(reportsDir)) return snapshot;
  for (const name of readdirSync(reportsDir)) {
    if (!name.endsWith('.md')) continue;
    const full = resolve(reportsDir, name);
    const stat = statSync(full);
    snapshot.set(`reports/${name}`, `${stat.size}:${stat.mtimeMs}`);
  }
  return snapshot;
}

function changedReports(root, before) {
  const reportsDir = resolve(root, 'reports');
  if (!existsSync(reportsDir)) return [];
  return readdirSync(reportsDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const full = resolve(reportsDir, name);
      const stat = statSync(full);
      const rel = `reports/${name}`;
      return { rel, full, stat, key: `${stat.size}:${stat.mtimeMs}` };
    })
    .filter((report) => before.get(report.rel) !== report.key)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

function sectionBody(text, headingPatterns) {
  const lines = String(text || '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^#{1,4}\s+(.+)$/)?.[1]?.toLowerCase() || '';
    if (heading && headingPatterns.some((pattern) => pattern.test(heading))) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return '';
  const body = [];
  for (let i = start; i < lines.length; i++) {
    if (/^#{1,4}\s+/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}

function bulletsFromSection(text, headingPatterns) {
  const body = sectionBody(text, headingPatterns);
  return [...body.matchAll(/^\s*[-*]\s+(.+)$/gm)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 8);
}

function fallbackRationale(text) {
  const block = sectionBody(text, [/match with cv/, /\bb\).*match/, /rationale/, /summary/]);
  return block.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 8);
}

function parseCareerOpsEvaluation(content, reportPath = '') {
  const score = scoreFromText(content);
  if (score == null) throw new Error('Career Ops evaluation output has no canonical 1-5 score.');
  const company = fieldFromScoreSummary(content, 'COMPANY')
    || parseSimpleYamlScalars(sectionBody(content, [/machine summary/])).company
    || String(content).match(/\*\*Company:\*\*\s*(.+)$/im)?.[1]?.trim()
    || '';
  const role = fieldFromScoreSummary(content, 'ROLE')
    || parseSimpleYamlScalars(sectionBody(content, [/machine summary/])).role
    || String(content).match(/\*\*Role:\*\*\s*(.+)$/im)?.[1]?.trim()
    || '';
  const archetype = fieldFromScoreSummary(content, 'ARCHETYPE')
    || String(content).match(/\*\*Archetype:\*\*\s*(.+)$/im)?.[1]?.trim()
    || '';
  const legitimacy = fieldFromScoreSummary(content, 'LEGITIMACY')
    || String(content).match(/\*\*Legitimacy:\*\*\s*(.+)$/im)?.[1]?.trim()
    || '';
  const explicitRecommendation = String(content).match(/\*\*Recommendation:\*\*\s*(.+)$/im)?.[1]?.trim()
    || String(content).match(/^Recommendation:\s*(.+)$/im)?.[1]?.trim()
    || '';
  const strongestEvidence = bulletsFromSection(content, [/strongest evidence/, /top strengths/, /\bstrengths\b/, /match with cv/]);
  const evidenceGaps = bulletsFromSection(content, [/evidence gaps/, /soft gaps/, /\bgaps\b/, /hard stops/]);
  const hardMismatches = bulletsFromSection(content, [/hard mismatches/, /hard stops/, /blockers/, /red flags/])
    .filter((line) => !/^none\.?$/i.test(line));
  return {
    company,
    role,
    canonical_score: score,
    score_scale: '1-5',
    archetype,
    legitimacy,
    explicit_recommendation: explicitRecommendation,
    strongest_evidence: strongestEvidence.length ? strongestEvidence : fallbackRationale(content),
    evidence_gaps: evidenceGaps,
    hard_mismatches: hardMismatches,
    career_ops_rationale: fallbackRationale(content),
    report_path: reportPath,
    report_sha256: sha256(content),
  };
}

function stripQuotes(value) {
  return String(value ?? '').trim().replace(/^["']|["']$/g, '');
}

function parseSimpleYamlScalars(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (!match) continue;
    const raw = stripQuotes(match[2]);
    out[match[1]] = raw === 'null' ? null : raw;
  }
  return out;
}

function findExistingEvaluation(root, job) {
  const reportsDir = resolve(root, 'reports');
  if (!existsSync(reportsDir)) return null;
  const reports = readdirSync(reportsDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => resolve(reportsDir, name))
    .map((file) => parseReportSummary(readFileSync(file, 'utf-8'), file, root))
    .filter(Boolean);
  const company = job.fields.company.value || '';
  const title = job.fields.title.value || '';
  const match = reports.find((report) => sameCompany(report.company, company) && (report.role === title || roleFuzzyMatch(report.role, title)));
  if (!match) return null;
  return {
    status: 'linked_existing_career_ops_report',
    canonical_score: match.score,
    score_scale: '1-5',
    reference: match.reference,
    evaluation_command: 'Career Ops modes/oferta.md report import',
    version: 'career-ops-1-5',
  };
}

function buildEvaluation(root, dataDir, job) {
  const profile = loadProfile(root);
  const cv = loadCv(root);
  const skillGaps = cv ? classifySkillGaps(extractJdSkills(job.description), cv) : { existing: [], supportedByResume: [], gap: [] };
  const linked = findExistingEvaluation(root, job);
  const jdPath = writeJobDescription(root, dataDir, job);
  return {
    ...linked || {
      status: 'pending_career_ops_evaluation',
      canonical_score: null,
      score_scale: '1-5',
      reference: jdPath,
      evaluation_command: `Run Career Ops evaluation mode against ${jdPath}`,
      version: 'career-ops-1-5',
    },
    tier: classifyTier(job.fields.title.value || ''),
    role_alignment: roleAlignment(job, profile),
    compensation: compensationResult(job, profile),
    location: locationResult(job, profile),
    strongest_evidence: skillGaps.existing.slice(0, 5),
    evidence_gaps: skillGaps.gap.slice(0, 8),
    hard_mismatches: hardMismatches(job),
    recommendation: recommendationFor(linked?.canonical_score ?? null, hardMismatches(job)),
  };
}

function readIfExists(root, relPath) {
  const full = resolve(root, relPath);
  return existsSync(full) ? readFileSync(full, 'utf-8') : '';
}

function parseBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseRetryCount(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function readEnvValue(filePath, key) {
  if (!filePath || !existsSync(filePath)) return '';
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = readFileSync(filePath, 'utf-8').match(new RegExp(`^\\s*${escaped}\\s*=\\s*(.*)\\s*$`, 'm'));
  if (!match) return '';
  return match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
}

function readHermesModelConfig(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  const out = {};
  let inModel = false;
  for (const raw of readFileSync(filePath, 'utf-8').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\s*model:\s*$/.test(line)) {
      inModel = true;
      continue;
    }
    if (inModel && /^\S/.test(line)) break;
    if (!inModel) continue;
    const match = line.match(/^\s{2,}(default|base_url|provider):\s*(.+?)\s*$/);
    if (!match) continue;
    if (match[1] === 'default') out.model = stripQuotes(match[2]);
    if (match[1] === 'base_url') out.baseUrl = stripQuotes(match[2]);
    if (match[1] === 'provider') out.hermesProvider = stripQuotes(match[2]);
  }
  return out;
}

function firstConfiguredValue(values, fallback) {
  for (const value of values) {
    if (value !== undefined && value !== null) return stripQuotes(value);
  }
  return fallback;
}

function redactSecrets(text, secrets = []) {
  let out = String(text || '');
  for (const secret of secrets.filter(Boolean)) {
    out = out.split(secret).join('[REDACTED]');
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
    .replace(/(OPENAI_API_KEY|NVIDIA_API_KEY|Authorization)\s*[:=]\s*[^\s]+/gi, '$1=[REDACTED]');
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function renderProviderEvaluator(policy) {
  return `node openai-eval.mjs --url ${policy.baseUrl} --model ${policy.model} --file {jd}`;
}

function resolveProviderPolicy({
  root = ROOT,
  env = process.env,
  provider,
  baseUrl,
  model,
  allowPaid,
  timeoutMs,
  maxRetries,
  hermesEnvPath = env.CAREER_OPS_HAWKEYE_HERMES_ENV || '/root/.hermes/.env',
  hermesConfigPath = env.CAREER_OPS_HAWKEYE_HERMES_CONFIG || '/root/.hermes/config.yaml',
} = {}) {
  const hermes = readHermesModelConfig(hermesConfigPath);
  const resolvedProvider = firstConfiguredValue([provider, env.CAREER_OPS_HAWKEYE_PROVIDER], DEFAULT_PROVIDER);
  const resolvedBaseUrl = firstConfiguredValue([baseUrl, env.CAREER_OPS_HAWKEYE_BASE_URL, hermes.baseUrl], DEFAULT_NVIDIA_BASE_URL);
  const resolvedModel = firstConfiguredValue([model, env.CAREER_OPS_HAWKEYE_MODEL, hermes.model], DEFAULT_NVIDIA_MODEL);
  const resolvedAllowPaid = parseBool(allowPaid ?? env.CAREER_OPS_HAWKEYE_ALLOW_PAID, false);
  const resolvedTimeoutMs = parsePositiveInt(timeoutMs || env.CAREER_OPS_HAWKEYE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const resolvedMaxRetries = parseRetryCount(maxRetries ?? env.CAREER_OPS_HAWKEYE_MAX_RETRIES, DEFAULT_MAX_RETRIES);
  const key = env.NVIDIA_API_KEY || readEnvValue(hermesEnvPath, 'NVIDIA_API_KEY');
  const host = hostFromUrl(resolvedBaseUrl);
  const policy = {
    provider: resolvedProvider,
    baseUrl: resolvedBaseUrl,
    baseUrlHostname: host,
    model: resolvedModel,
    allowPaid: resolvedAllowPaid,
    timeoutMs: resolvedTimeoutMs,
    maxRetries: Math.min(resolvedMaxRetries, DEFAULT_MAX_RETRIES),
    evaluatorVersion: 'hawkeye-provider-policy-v1+nvidia-nim+career-ops-1-5',
    key,
    keySource: key ? (env.NVIDIA_API_KEY ? 'environment' : 'hermes-env-file') : 'missing',
    root,
  };
  validateProviderPolicy(policy);
  return policy;
}

function validateProviderPolicy(policy) {
  if (policy.provider !== 'nvidia-nim') {
    throw new Error(`Provider "${policy.provider || 'unavailable'}" is not approved for Hawkeye evaluation. Approved provider: nvidia-nim.`);
  }
  if (!policy.key) throw new Error('NVIDIA_API_KEY is required for nvidia-nim evaluation.');
  if (!policy.baseUrl) throw new Error('NVIDIA NIM base URL is required.');
  if (!policy.model) throw new Error('NVIDIA NIM model is required.');
  if (policy.allowPaid) throw new Error('Paid fallback remains disabled for Hawkeye evaluation.');
  if (policy.baseUrl === 'https://api.openai.com/v1' || policy.baseUrlHostname === 'api.openai.com') {
    throw new Error('Paid OpenAI fallback is blocked for Hawkeye evaluation.');
  }
}

function evaluationInputHash(root, jdPath, evaluatorTemplate) {
  const parts = [
    readFileSync(jdPath, 'utf-8'),
    readIfExists(root, 'cv.md'),
    readIfExists(root, 'config/profile.yml'),
    readIfExists(root, 'modes/_profile.md'),
    readIfExists(root, 'modes/_custom.md'),
    evaluatorTemplate,
  ];
  return sha256(parts.join('\n---hawkeye-input-boundary---\n'));
}

function splitCommandTemplate(template) {
  const args = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const char of String(template || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (quote) throw new Error('Evaluator command has an unterminated quote.');
  if (escaped) current += '\\';
  if (current) args.push(current);
  if (args.length === 0) throw new Error('Evaluator command is empty.');
  return args;
}

function commandIncludes(parts, value) {
  return parts.some((part) => String(part).includes(value));
}

function argAfter(parts, flag) {
  const idx = parts.indexOf(flag);
  return idx === -1 ? '' : parts[idx + 1] || '';
}

function validateEvaluatorCommandPolicy(parts, policy, explicitEvaluator) {
  const commandText = parts.join(' ');
  const usesOpenAiEval = commandIncludes(parts, 'openai-eval.mjs');
  if (!usesOpenAiEval) return;
  const url = argAfter(parts, '--url') || process.env.OPENAI_BASE_URL || '';
  const model = argAfter(parts, '--model') || process.env.OPENAI_MODEL || '';
  if (!url) {
    throw new Error('OpenAI-compatible Hawkeye evaluation requires an explicit approved --url; api.openai.com fallback is blocked.');
  }
  if (hostFromUrl(url) === 'api.openai.com' && !policy?.allowPaid) {
    throw new Error('Paid OpenAI fallback is blocked for Hawkeye evaluation.');
  }
  if (explicitEvaluator && policy?.provider === 'nvidia-nim') {
    if (url.replace(/\/$/, '') !== policy.baseUrl.replace(/\/$/, '')) {
      throw new Error(`Evaluator URL host "${hostFromUrl(url) || 'unavailable'}" does not match approved provider host "${policy.baseUrlHostname}".`);
    }
    if (!model) throw new Error('NVIDIA NIM model is required.');
  }
  if (/api\.openai\.com/i.test(commandText) && !policy?.allowPaid) {
    throw new Error('Paid OpenAI fallback is blocked for Hawkeye evaluation.');
  }
}

function resolveEvaluatorCommand(template, root, job, jdPath, policy = null, explicitEvaluator = false) {
  const rendered = String(template)
    .replaceAll('{jd}', jdPath)
    .replaceAll('{job_id}', job.job_id);
  const parts = splitCommandTemplate(rendered);
  const executable = parts[0] === 'node' ? process.execPath : parts[0];
  const args = parts.slice(1);
  const commandText = [parts[0], ...args].join(' ');
  const forbidden = [
    'generate-pdf.mjs',
    'generate-cover-letter.mjs',
    'prepare-application.mjs',
    'application-answers.mjs',
    'browser-extract.mjs',
    'scan.mjs',
    'scan-ats-full.mjs',
    'gmail',
    'submit',
    'portal',
  ];
  if (forbidden.some((token) => commandText.toLowerCase().includes(token.toLowerCase()))) {
    throw new Error(`Evaluator command is not allowed for Hawkeye evaluation bridge: ${tokenFromForbidden(commandText, forbidden)}`);
  }
  validateEvaluatorCommandPolicy(parts, policy, explicitEvaluator);
  return { executable, args, commandText, cwd: root };
}

function tokenFromForbidden(commandText, forbidden) {
  return forbidden.find((token) => commandText.toLowerCase().includes(token.toLowerCase())) || 'external action';
}

function validateEvaluationIdentity(parsed, job) {
  const company = parsed.company && parsed.company.toLowerCase() !== 'unknown' ? parsed.company : '';
  const role = parsed.role && parsed.role.toLowerCase() !== 'unknown' ? parsed.role : '';
  const jobCompany = job.fields.company.value || '';
  const jobTitle = job.fields.title.value || '';
  if (company && jobCompany && !sameCompany(company, jobCompany)) {
    throw new Error(`Career Ops evaluation company "${company}" conflicts with Hawkeye job company "${jobCompany}".`);
  }
  if (role && jobTitle && role !== jobTitle && !roleFuzzyMatch(role, jobTitle)) {
    throw new Error(`Career Ops evaluation role "${role}" conflicts with Hawkeye job title "${jobTitle}".`);
  }
}

function recommendationFromCareerOps(score, hardMismatches, explicitRecommendation = '') {
  const explicit = explicitRecommendation.toLowerCase();
  if (hardMismatches.length) return 'reject';
  if (/\b(reject|do not apply|against applying|no apply)\b/.test(explicit)) return 'reject';
  if (/\bwatch|research|exceptional review|conditional\b/.test(explicit)) return 'watch';
  return recommendationFor(score, hardMismatches);
}

export function evaluateJob(jobId, {
  root = ROOT,
  dataDir = DEFAULT_DATA_DIR,
  evaluator = null,
  actor = 'local-user',
  force = false,
  timeoutMs = null,
  maxRetries = null,
  provider = null,
  baseUrl = null,
  model = null,
  allowPaid = null,
  env = process.env,
  hermesEnvPath = env.CAREER_OPS_HAWKEYE_HERMES_ENV || '/root/.hermes/.env',
  hermesConfigPath = env.CAREER_OPS_HAWKEYE_HERMES_CONFIG || '/root/.hermes/config.yaml',
} = {}) {
  const state = loadState(root, dataDir);
  const job = state.jobs.find((item) => item.job_id === jobId);
  if (!job) throw new Error(`Unknown Hawkeye job ID: ${jobId}`);
  const currentReference = job.evaluation?.reference || '';
  const jdRel = job.evaluation?.jd_path
    || (currentReference && !currentReference.startsWith('reports/') ? currentReference : join(dataDir, JDS_DIR, `${job.job_id}.md`));
  const jdPath = resolve(root, jdRel);
  if (!existsSync(jdPath)) throw new Error(`Hawkeye JD file is missing: ${jdRel}`);
  const explicitEvaluator = Boolean(evaluator);
  const policy = explicitEvaluator
    ? null
    : resolveProviderPolicy({ root, env, provider, baseUrl, model, allowPaid, timeoutMs, maxRetries, hermesEnvPath, hermesConfigPath });
  const evaluatorTemplate = evaluator || env.CAREER_OPS_HAWKEYE_EVALUATOR || renderProviderEvaluator(policy);
  const effectiveTimeoutMs = parsePositiveInt(timeoutMs || policy?.timeoutMs || env.CAREER_OPS_HAWKEYE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const effectiveMaxRetries = policy?.maxRetries ?? 0;
  const inputHash = evaluationInputHash(root, jdPath, [
    evaluatorTemplate,
    policy?.provider || 'custom',
    policy?.baseUrl || '',
    policy?.model || '',
    policy?.allowPaid ? 'paid-allowed' : 'paid-disabled',
  ].join('\n'));
  if (!force && job.evaluation?.status === 'career_ops_evaluated' && job.evaluation?.input_hash === inputHash) {
    return { ok: true, skipped: true, reason: 'unchanged evaluation inputs', job_id: job.job_id, evaluation: job.evaluation };
  }
  const command = resolveEvaluatorCommand(evaluatorTemplate, root, job, jdPath, policy, explicitEvaluator);
  const reportsBefore = reportSnapshot(root);
  let stdout = '';
  let attempts = 0;
  const childEnv = {
    ...env,
    HAWKEYE_JOB_ID: job.job_id,
    HAWKEYE_JD_FILE: jdPath,
  };
  if (policy) {
    childEnv.OPENAI_API_KEY = policy.key;
    childEnv.OPENAI_BASE_URL = policy.baseUrl;
    childEnv.OPENAI_MODEL = policy.model;
  }
  for (;;) {
    attempts++;
    try {
      stdout = execFileSync(command.executable, command.args, {
        cwd: command.cwd,
        encoding: 'utf-8',
        timeout: effectiveTimeoutMs,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      break;
    } catch (err) {
      const raw = err.stderr?.toString()?.trim() || err.message;
      const safe = redactSecrets(raw, [policy?.key, env.OPENAI_API_KEY, env.NVIDIA_API_KEY]);
      const retryable = policy && attempts <= effectiveMaxRetries && /(?:HTTP\s+5\d\d|temporar|ECONNRESET|ETIMEDOUT|network)/i.test(safe);
      const stop = /(?:quota|insufficient_quota|rate.?limit|HTTP\s+4(?:01|03|29)|authentication|unauthorized|forbidden)/i.test(safe);
      if (retryable && !stop) continue;
      throw new Error(`Career Ops evaluation failed: ${safe}`);
    }
  }
  const reportRelFromOutput = firstReportPathFromOutput(stdout);
  const reportCandidate = reportRelFromOutput
    ? { rel: reportRelFromOutput, full: resolve(root, reportRelFromOutput) }
    : changedReports(root, reportsBefore)[0];
  const reportRel = reportCandidate?.rel || '';
  const reportPath = reportCandidate?.full || '';
  const reportContent = reportPath && existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : stdout;
  if (!reportContent.trim()) throw new Error('Career Ops evaluation produced no parseable output.');
  const parsed = parseCareerOpsEvaluation(reportContent, reportRel);
  validateEvaluationIdentity(parsed, job);
  const profile = loadProfile(root);
  const previousReference = job.evaluation?.report_path || (currentReference.startsWith('reports/') ? currentReference : '');
  const previousHash = job.evaluation?.input_hash || '';
  job.evaluation = {
    status: 'career_ops_evaluated',
    evaluation_status: 'career_ops_evaluated',
    canonical_score: parsed.canonical_score,
    score_scale: parsed.score_scale,
    tier: classifyTier(job.fields.title.value || ''),
    archetype: parsed.archetype || null,
    legitimacy: parsed.legitimacy || null,
    role_alignment: roleAlignment(job, profile),
    compensation: compensationResult(job, profile),
    location: locationResult(job, profile),
    strongest_evidence: parsed.strongest_evidence,
    evidence_gaps: parsed.evidence_gaps,
    hard_mismatches: parsed.hard_mismatches.length ? parsed.hard_mismatches : hardMismatches(job),
    recommendation: recommendationFromCareerOps(parsed.canonical_score, parsed.hard_mismatches, parsed.explicit_recommendation),
    report_path: parsed.report_path || null,
    reference: jdRel,
    jd_path: jdRel,
    evaluator_command: command.commandText,
    evaluation_command: command.commandText,
    evaluator_provider: policy?.provider || 'custom',
    evaluator_model: policy?.model || null,
    evaluator_base_url_hostname: policy?.baseUrlHostname || null,
    evaluator_paid_allowed: Boolean(policy?.allowPaid),
    evaluator_timeout_ms: effectiveTimeoutMs,
    evaluator_max_retries: effectiveMaxRetries,
    evaluator_attempts: attempts,
    provider_status: 'success',
    evaluator_version: policy?.evaluatorVersion || 'career-ops-1-5',
    version: 'career-ops-1-5',
    evaluated_at: nowIso(),
    input_hash: inputHash,
    report_sha256: parsed.report_sha256,
    career_ops_rationale: parsed.career_ops_rationale,
    previous_evaluation_reference: previousReference || null,
  };
  saveState(root, dataDir, state);
  appendAudit(root, dataDir, {
    event: 'evaluation',
    job_id: job.job_id,
    prior_state: previousHash ? 'career_ops_evaluated' : 'pending_career_ops_evaluation',
    new_state: 'career_ops_evaluated',
    actor,
    reason: previousHash && previousHash !== inputHash ? 'reevaluation after changed inputs' : 'career-ops evaluation attached',
    source_file: relative(root, job.source_file),
    evaluation_reference: job.evaluation.report_path || job.evaluation.reference,
    previous_evaluation_reference: previousReference,
    canonical_score: job.evaluation.canonical_score,
    evaluator_provider: job.evaluation.evaluator_provider,
    evaluator_model: job.evaluation.evaluator_model,
    evaluator_base_url_hostname: job.evaluation.evaluator_base_url_hostname,
    evaluator_version: job.evaluation.evaluator_version,
    evaluator_timeout_ms: job.evaluation.evaluator_timeout_ms,
    provider_status: job.evaluation.provider_status,
  });
  return { ok: true, skipped: false, job_id: job.job_id, evaluation: job.evaluation };
}

function hardMismatches(job) {
  const text = `${job.fields.title.value || ''}\n${job.description}`.toLowerCase();
  const mismatches = [];
  for (const [label, re] of [
    ['junior or entry-level role', /\b(junior|entry[- ]level|internship|intern)\b/],
    ['commission-only role', /\bcommission[- ]only\b/],
    ['clearance-required role', /\b(active\s+)?(security\s+)?clearance|required clearance|top secret\b/],
    ['PhD-heavy role', /\bphd\b|ph\.d\./],
    ['research scientist role', /\bresearch scientist\b|\bapplied scientist\b/],
  ]) {
    if (re.test(text)) mismatches.push(label);
  }
  return mismatches;
}

function recommendationFor(score, mismatches = []) {
  if (mismatches.length) return 'reject';
  if (score == null) return 'watch';
  if (score >= 4.5) return 'strong';
  if (score >= 4.0) return 'good';
  if (score >= 3.5) return 'watch';
  return 'reject';
}

function groupFor(job) {
  const score = job.evaluation?.canonical_score;
  if (job.evaluation?.hard_mismatches?.length) return 'reject';
  if (score == null) return 'watch';
  if (score >= 4.5) return 'strong';
  if (score >= 4.0) return 'good';
  if (score >= 3.5) return 'watch';
  return 'reject';
}

export function ingest({ root = ROOT, inboxDir = DEFAULT_INBOX_DIR, dataDir = DEFAULT_DATA_DIR, actor = 'local-user' } = {}) {
  const files = listSourceFiles(root, inboxDir);
  const state = loadState(root, dataDir);
  const results = [];
  for (const file of files) {
    const sourceHashBefore = sha256(readFileSync(file, 'utf-8'));
    const candidate = normalizeSourceFile(file);
    const dedup = classifyDuplicate(candidate, state.jobs);
    const existing = state.jobs.find((job) => job.job_id === candidate.job_id);
    let stored = existing;
    if (!existing && dedup.status !== 'exact_duplicate') {
      stored = {
        ...candidate,
        deduplication: dedup,
        decision: { state: 'watch', updated_at: nowIso(), actor: 'hawkeye', reason: 'default state after local inbox import' },
        evaluation: buildEvaluation(root, dataDir, candidate),
        imported_at: nowIso(),
      };
      state.jobs.push(stored);
      appendAudit(root, dataDir, {
        event: 'ingest',
        job_id: stored.job_id,
        prior_state: null,
        new_state: stored.decision.state,
        actor,
        reason: 'local inbox import',
        source_file: relative(root, file),
        evaluation_reference: stored.evaluation.reference,
        deduplication_status: dedup.status,
      });
    } else if (existing) {
      existing.deduplication = dedup;
      if (existing.evaluation?.status !== 'career_ops_evaluated' || existing.source_sha256 !== candidate.source_sha256) {
        existing.evaluation = buildEvaluation(root, dataDir, existing);
      }
      stored = existing;
    }
    const sourceHashAfter = sha256(readFileSync(file, 'utf-8'));
    results.push({
      job_id: candidate.job_id,
      source_file: relative(root, file),
      deduplication_status: dedup.status,
      imported: Boolean(!existing && dedup.status !== 'exact_duplicate'),
      source_mutated: sourceHashBefore !== sourceHashAfter,
      evaluation_status: stored?.evaluation?.status || 'not_imported',
    });
  }
  state.jobs.sort((a, b) => a.job_id.localeCompare(b.job_id));
  saveState(root, dataDir, state);
  return { ok: true, files_read: files.length, jobs_total: state.jobs.length, results };
}

export function shortlist({ root = ROOT, dataDir = DEFAULT_DATA_DIR } = {}) {
  const state = loadState(root, dataDir);
  const groups = { strong: [], good: [], watch: [], reject: [] };
  for (const job of state.jobs) groups[groupFor(job)].push(summaryRow(job));
  for (const group of Object.values(groups)) {
    group.sort((a, b) => (b.score_value ?? -1) - (a.score_value ?? -1) || a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  }
  return groups;
}

function summaryRow(job) {
  const comp = job.fields.compensation.value;
  return {
    job_id: job.job_id,
    company: job.fields.company.value || UNAVAILABLE,
    title: job.fields.title.value || UNAVAILABLE,
    location: job.fields.location.value || UNAVAILABLE,
    compensation: comp ? formatCompensation(comp) || comp.raw || JSON.stringify(comp) : UNAVAILABLE,
    score: job.evaluation?.canonical_score == null ? UNAVAILABLE : `${job.evaluation.canonical_score}/5`,
    score_value: job.evaluation?.canonical_score,
    recommendation: job.evaluation?.recommendation || 'watch',
    strongest_match: job.evaluation?.strongest_evidence?.[0] || job.evaluation?.role_alignment?.detail || UNAVAILABLE,
    biggest_gap: job.evaluation?.hard_mismatches?.[0] || job.evaluation?.evidence_gaps?.[0] || UNAVAILABLE,
    decision_state: job.decision?.state || 'watch',
  };
}

export function getJob(jobId, { root = ROOT, dataDir = DEFAULT_DATA_DIR } = {}) {
  const state = loadState(root, dataDir);
  return state.jobs.find((job) => job.job_id === jobId) || null;
}

export function decide(jobId, newState, { root = ROOT, dataDir = DEFAULT_DATA_DIR, actor = 'local-user', reason = '' } = {}) {
  if (!DECISIONS.has(newState)) {
    throw new Error(`Invalid decision state "${newState}". Use approve, reject, watch, or research.`);
  }
  const state = loadState(root, dataDir);
  const job = state.jobs.find((item) => item.job_id === jobId);
  if (!job) throw new Error(`Unknown Hawkeye job ID: ${jobId}`);
  const prior = job.decision?.state || 'watch';
  job.decision = { state: newState, updated_at: nowIso(), actor, reason };
  saveState(root, dataDir, state);
  appendAudit(root, dataDir, {
    event: 'decision',
    job_id: job.job_id,
    prior_state: prior,
    new_state: newState,
    actor,
    reason,
    source_file: relative(root, job.source_file),
    evaluation_reference: job.evaluation?.report_path || job.evaluation?.reference || '',
    note: newState === 'approve' ? 'Approved for later application-package preparation only; not approval to apply or submit.' : '',
  });
  return job.decision;
}

function renderShortlist(groups) {
  const lines = [];
  for (const name of ['strong', 'good', 'watch', 'reject']) {
    lines.push(`\n## ${name}`);
    if (groups[name].length === 0) {
      lines.push('No roles.');
      continue;
    }
    for (const row of groups[name]) {
      lines.push([
        row.job_id,
        sanitizeMarkdownField(row.company),
        sanitizeMarkdownField(row.title),
        sanitizeMarkdownField(row.location),
        sanitizeMarkdownField(row.compensation),
        row.score,
        row.recommendation,
        `match: ${sanitizeMarkdownField(row.strongest_match)}`,
        `gap: ${sanitizeMarkdownField(row.biggest_gap)}`,
        `decision: ${row.decision_state}`,
      ].join(' | '));
    }
  }
  return lines.join('\n').trimStart();
}

function renderJob(job) {
  return JSON.stringify(job, null, 2);
}

export async function runCli(argv = process.argv.slice(2), root = process.cwd()) {
  const args = parseArgs(argv);
  const [cmd, first, second] = args._;
  if (args.help || !cmd) return { code: 0, stdout: usage(), stderr: '' };
  if (FORBIDDEN_COMMANDS.has(cmd)) {
    return {
      code: 2,
      stdout: '',
      stderr: `Hawkeye MVP fails closed: "${cmd}" is an external/application action and is not supported.`,
    };
  }
  const dataDir = args.dataDir || DEFAULT_DATA_DIR;
  try {
    if (cmd === 'ingest') {
      const result = ingest({ root, dataDir, inboxDir: args.inbox || DEFAULT_INBOX_DIR, actor: args.actor || 'local-user' });
      return { code: 0, stdout: JSON.stringify(result, null, 2), stderr: '' };
    }
    if (cmd === 'evaluate') {
      if (!first) throw new Error('evaluate requires <job-id>.');
      const result = evaluateJob(first, {
        root,
        dataDir,
        evaluator: args.evaluator || null,
        actor: args.actor || 'local-user',
        force: Boolean(args.force),
        timeoutMs: args.timeoutMs || null,
        maxRetries: args.maxRetries || null,
        provider: args.provider || null,
        baseUrl: args.baseUrl || null,
        model: args.model || null,
        allowPaid: args.allowPaid ?? null,
      });
      return { code: 0, stdout: JSON.stringify(result, null, 2), stderr: '' };
    }
    if (cmd === 'shortlist') {
      return { code: 0, stdout: renderShortlist(shortlist({ root, dataDir })), stderr: '' };
    }
    if (cmd === 'show') {
      if (!first) throw new Error('show requires <job-id>.');
      const job = getJob(first, { root, dataDir });
      if (!job) throw new Error(`Unknown Hawkeye job ID: ${first}`);
      return { code: 0, stdout: renderJob(job), stderr: '' };
    }
    if (cmd === 'decide') {
      if (!first || !second) throw new Error('decide requires <job-id> <approve|reject|watch|research>.');
      const result = decide(first, second, {
        root,
        dataDir,
        actor: args.actor || 'local-user',
        reason: args.reason || '',
      });
      return { code: 0, stdout: JSON.stringify(result, null, 2), stderr: '' };
    }
    return { code: 2, stdout: '', stderr: `Unknown command: ${cmd}\n\n${usage()}` };
  } catch (err) {
    return { code: 1, stdout: '', stderr: err.message || String(err) };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const result = await runCli(process.argv.slice(2), process.cwd());
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(result.code);
}
