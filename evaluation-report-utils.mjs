import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export const UNAVAILABLE = 'unavailable';

function normalizeValue(value) {
  return String(value ?? '').trim();
}

function isMeaningful(value) {
  const cleaned = normalizeValue(value);
  return cleaned && !/^(unknown|unavailable|n\/a|null|\?)$/i.test(cleaned);
}

function normalizeCompare(value) {
  return normalizeValue(value).toLowerCase().replace(/\s+/g, ' ');
}

function uniqueMeaningful(values) {
  const out = [];
  for (const value of values.map(normalizeValue).filter(isMeaningful)) {
    if (!out.some((existing) => normalizeCompare(existing) === normalizeCompare(value))) out.push(value);
  }
  return out;
}

function pickUnambiguous(label, values) {
  const unique = uniqueMeaningful(values);
  if (unique.length > 1) {
    throw new Error(`Ambiguous Career Ops evaluation ${label}: ${unique.join(' | ')}`);
  }
  return unique[0] || '';
}

export function scoreSummaryBlock(text) {
  return String(text || '').match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/)?.[1] || '';
}

export function fieldFromScoreSummary(text, key) {
  const summary = scoreSummaryBlock(text);
  const match = summary.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'im'));
  return match ? match[1].trim() : '';
}

export function evaluationHeading(text) {
  const matches = [...String(text || '').matchAll(/^#\s+Evaluation:\s+(.+?)\s+(?:—|-)\s+(.+?)\s*$/gm)]
    .map((match) => ({ company: match[1].trim(), role: match[2].trim() }))
    .filter((item) => isMeaningful(item.company) || isMeaningful(item.role));
  if (matches.length === 0) return { company: '', role: '' };
  const company = pickUnambiguous('company', matches.map((item) => item.company));
  const role = pickUnambiguous('role', matches.map((item) => item.role));
  return { company, role };
}

function fieldMatches(text, label) {
  return [...String(text || '').matchAll(new RegExp(`^\\s*\\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, 'gim'))]
    .map((match) => match[1].trim());
}

export function parseEvaluationMetadata(text) {
  const heading = evaluationHeading(text);
  const company = pickUnambiguous('company', [
    fieldFromScoreSummary(text, 'COMPANY'),
    ...fieldMatches(text, 'Company'),
    heading.company,
  ]);
  const role = pickUnambiguous('role', [
    fieldFromScoreSummary(text, 'ROLE'),
    ...fieldMatches(text, 'Role'),
    heading.role,
  ]);
  const archetype = pickUnambiguous('archetype', [
    fieldFromScoreSummary(text, 'ARCHETYPE'),
    ...fieldMatches(text, 'Archetype'),
  ]);
  const legitimacy = pickUnambiguous('legitimacy', [
    fieldFromScoreSummary(text, 'LEGITIMACY'),
    ...fieldMatches(text, 'Legitimacy'),
  ]);
  const scoreTexts = uniqueMeaningful([
    fieldFromScoreSummary(text, 'SCORE'),
    ...[...String(text || '').matchAll(/^\s*\*\*Score:\*\*\s*([0-9]+(?:\.[0-9]+)?)\/5\s*$/gim)].map((m) => m[1]),
    ...[...String(text || '').matchAll(/^\s*score:\s*([0-9]+(?:\.[0-9]+)?)\s*$/gim)].map((m) => m[1]),
  ]);
  if (scoreTexts.length > 1) {
    throw new Error(`Ambiguous Career Ops evaluation score: ${scoreTexts.join(' | ')}`);
  }
  const score = scoreTexts[0] == null ? null : Number(scoreTexts[0]);
  if (score != null && (!Number.isFinite(score) || score < 1 || score > 5)) {
    throw new Error(`Invalid Career Ops evaluation score: ${scoreTexts[0]}`);
  }
  return {
    company,
    role,
    score,
    scoreText: score == null ? '' : String(score),
    archetype,
    legitimacy,
  };
}

export function safeReportSlug(...values) {
  const slug = values
    .filter(isMeaningful)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  return slug || 'unknown';
}

export function stripMarkup(text) {
  return String(text || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^}]*)\})?/g, ' $1 ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeClaimText(claim) {
  return stripMarkup(claim).toLowerCase().replace(/[,\s]+/g, ' ').replace(/[.);:]+$/g, '').trim();
}

function extractMetricTokens(text) {
  const clean = stripMarkup(text);
  const patterns = [
    /\b\d+(?:\.\d+)?\s?%/g,
    /\b[$€£]\s?\d[\d,.]*(?:\s?[kKmMbB])?/g,
    /\b\d+(?:\.\d+)?\s?x\b/gi,
    /\b\d[\d,.]*\+?(?:\s|-)(?:(?:[A-Za-z-]+)\s+){0,2}(?:users|customers|clients|employees|engineers|teams|companies|industries|hours|days|weeks|months|years|minutes|seconds|requests|tokens|documents|workflows|pipelines|agents|interviews|applications|offers|reports|cvs|resumes|tests|nodes?|fixes|roi)\b/gi,
  ];
  const claims = [];
  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) claims.push(normalizeClaimText(match[0]));
  }
  return claims;
}

function materialLines(text) {
  const lines = [];
  const material = /\b(?:clients?|customers?|industries|roi|revenue|savings?|costs?|adoption|retention|reduction|increase|decrease|outcomes?|metrics?|emergency fixes|attorney timekeeper|enterprise clients?|time savings|sponsorship required|requires sponsorship|needs sponsorship)\b/i;
  let currentSection = '';
  for (const raw of String(text || '').split('\n')) {
    const heading = raw.match(/^#{1,6}\s+(.+)$/)?.[1]?.toLowerCase();
    if (heading) {
      currentSection = heading;
      continue;
    }
    if (/\b(?:machine summary|comp and demand|posting legitimacy|risk summary|evidence gaps|gaps flagged)\b/i.test(currentSection)) continue;
    const line = raw.replace(/^\s*[-*]\s+/, '').replace(/^\s*\|?/, '').trim();
    if (!line || /^```/.test(line) || /^[-|:\s]+$/.test(line)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(line)) continue;
    if (/\b(?:advertised range|advertised_comp|compensation reliability|market context|salary|source url)\b/i.test(line) && !/\b(?:roi|savings?|reduction|costs?)\b/i.test(line)) continue;
    if (extractMetricTokens(line).length || material.test(line)) lines.push(line);
  }
  return lines;
}

function canonicalSourceText(root, sources) {
  return sources
    .map((source) => resolve(root, source))
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, 'utf-8'))
    .join('\n');
}

function sourceSupport(claim, sourceText) {
  const normalizedClaim = normalizeClaimText(claim);
  const normalizedSource = normalizeClaimText(sourceText);
  if (!normalizedClaim) return 'none';
  if (normalizedSource.includes(normalizedClaim)) return 'exact';
  const stopwords = new Set(['and', 'for', 'from', 'through', 'with', 'the', 'into', 'produced', 'delivered', 'built', 'using']);
  const tokens = normalizedClaim.split(' ').filter((token) => token.length > 2 && !stopwords.has(token));
  return tokens.length > 0 && tokens.every((token) => normalizedSource.includes(token)) ? 'paraphrase' : 'none';
}

export function verifyReportClaims(reportText, {
  root = process.cwd(),
  sources = ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'modes/_custom.md'],
} = {}) {
  const sourceText = canonicalSourceText(root, sources);
  const sourceMetrics = new Set(extractMetricTokens(sourceText));
  const verified = [];
  const supported_but_paraphrased = [];
  const unsupported = [];
  const contradictory = [];
  const unverifiable = [];
  const seen = new Set();

  for (const line of materialLines(reportText)) {
    const normalizedLine = normalizeClaimText(line);
    if (!normalizedLine || seen.has(normalizedLine)) continue;
    seen.add(normalizedLine);

    if (/\b(?:sponsorship required|requires sponsorship|needs sponsorship)\b/i.test(line)
      && /\b(?:no sponsorship needed|no sponsorship required)\b/i.test(sourceText)) {
      contradictory.push({ claim: line, reason: 'contradicts work authorization source' });
      continue;
    }

    const metrics = extractMetricTokens(line);
    const unsupportedMetrics = metrics.filter((claim) => !sourceMetrics.has(claim) && sourceSupport(claim, sourceText) === 'none');
    if (unsupportedMetrics.length > 0) {
      unsupported.push({ claim: line, reason: `unsupported metric: ${unsupportedMetrics.join(', ')}` });
      continue;
    }

    if (metrics.length > 0 && metrics.every((claim) => sourceMetrics.has(claim) || sourceSupport(claim, sourceText) !== 'none')) {
      verified.push({ claim: line, reason: 'metric traced to canonical sources' });
      continue;
    }

    const support = sourceSupport(line, sourceText);
    if (support === 'exact') {
      verified.push({ claim: line, reason: 'claim traced to canonical sources' });
    } else if (support === 'paraphrase') {
      supported_but_paraphrased.push({ claim: line, reason: 'claim tokens traced to canonical sources' });
    } else {
      unverifiable.push({ claim: line, reason: 'material claim not traceable to canonical sources' });
    }
  }

  const status = contradictory.length
    ? 'evaluation_rejected_untrusted'
    : unsupported.length || unverifiable.length
      ? 'evaluation_requires_review'
      : 'evaluation_complete';
  return {
    status,
    verified,
    supported_but_paraphrased,
    unsupported,
    contradictory,
    unverifiable,
    canonical_sources: sources,
  };
}

export function filterUsableEvidence(lines, verification) {
  const blocked = new Set([
    ...(verification?.unsupported || []),
    ...(verification?.contradictory || []),
    ...(verification?.unverifiable || []),
  ].map((item) => normalizeClaimText(item.claim)));
  return lines.filter((line) => !blocked.has(normalizeClaimText(line)));
}
