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
  return 'reject';
}

function groupFor(job) {
  const score = job.evaluation?.canonical_score;
  if (job.evaluation?.hard_mismatches?.length) return 'reject';
  if (score == null) return 'watch';
  if (score >= 4.5) return 'strong';
  if (score >= 4.0) return 'good';
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
      existing.evaluation = buildEvaluation(root, dataDir, existing);
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
    evaluation_reference: job.evaluation?.reference || '',
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
