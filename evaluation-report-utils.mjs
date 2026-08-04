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

export function extractMetricTokens(text) {
  const clean = stripMarkup(text);
  const patterns = [
    /\b\d+(?:\.\d+)?\s?%/g,
    /\b[$€£]\s?\d[\d,.]*(?:\s?[kKmMbB])?/g,
    /\b\d+(?:\.\d+)?\s?x\b/gi,
    /\b\d[\d,.]*\+?(?:\s|-)(?:(?:[A-Za-z-]+)\s+){0,2}(?:users|customers|clients|employees|engineers|teams|companies|industries|hours|days|weeks|months|years|minutes|seconds|requests|tokens|documents|workflows|pipelines|agents|interviews|applications|offers|reports|cvs|resumes|tests|nodes?|fixes|roi|leaders|executives|workshops|deployments|members|direct reports|people)\b/gi,
  ];
  const claims = [];
  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) claims.push(normalizeClaimText(match[0]));
  }
  return claims;
}

const APPLICATION_MATERIAL_HEADING_RE = /\b(?:cover letter(?: draft)?|outreach draft|recruiter message|application answers|application draft|networking message|follow[-\s]?up message)\b/i;
const APPLICATION_MATERIAL_CONTENT_RE = /\b(?:dear hiring manager|dear recruiter|i am excited to apply|i'm excited to apply|i am writing to apply|please find attached|thank you for considering my application|would welcome the opportunity to discuss|linkedin outreach|recruiter outreach)\b/i;
const VERIFICATION_SECTION_RE = /\b(?:claim verification|source verification|fact verification|verification section|verification notes|candidate-claim verification)\b/i;

function headingLabel(raw) {
  const line = String(raw || '').trim();
  const markdown = line.match(/^#{1,6}\s+(.+)$/);
  if (markdown) return markdown[1].replace(/\s+#*$/, '').trim();
  const plain = line.match(/^(?:\*\*)?([A-Z][A-Za-z /&-]{2,})(?:\*\*)?:\s*$/);
  return plain ? plain[1].trim() : '';
}

function isApplicationMaterialHeading(raw) {
  const label = headingLabel(raw);
  return Boolean(label && APPLICATION_MATERIAL_HEADING_RE.test(label));
}

function isSectionBoundary(raw) {
  return Boolean(headingLabel(raw));
}

export function stripApplicationMaterialSections(reportText) {
  const lines = String(reportText || '').replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  const removedSections = [];
  const removedContentLines = [];
  let stripping = false;

  for (const raw of lines) {
    if (isApplicationMaterialHeading(raw)) {
      stripping = true;
      removedSections.push(headingLabel(raw));
      continue;
    }
    if (stripping && isSectionBoundary(raw)) {
      stripping = false;
    }
    if (stripping) continue;
    if (APPLICATION_MATERIAL_CONTENT_RE.test(raw)) {
      removedContentLines.push(raw.trim());
      continue;
    }
    kept.push(raw);
  }

  return {
    content: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() + (kept.length ? '\n' : ''),
    removedSections,
    removedContentLines,
  };
}

function materialLines(text) {
  const lines = [];
  const material = /\b(?:clients?|customers?|industries|roi|revenue|savings?|costs?|adoption|retention|reduction|increase|decrease|outcomes?|metrics?|emergency fixes|attorney timekeeper|enterprise clients?|time savings|production[-\s]?scale|deployed|deployments?|executive workshops?|business outcomes?|team size|direct reports?|sponsorship required|requires sponsorship|needs sponsorship)\b/i;
  let currentSection = '';
  for (const raw of String(text || '').split('\n')) {
    const heading = raw.match(/^#{1,6}\s+(.+)$/)?.[1]?.toLowerCase();
    if (heading) {
      currentSection = heading;
      continue;
    }
    if (/\b(?:machine summary|comp and demand|posting legitimacy|risk summary|evidence gaps|gaps flagged|claim verification|source verification|fact verification)\b/i.test(currentSection)) continue;
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

function lineMatchesBlockedClaim(line, blockedClaims) {
  const normalizedLine = normalizeClaimText(line).replace(/\s*\|\s*/g, ' ');
  return blockedClaims.some((claim) => {
    const normalizedClaim = normalizeClaimText(claim).replace(/\s*\|\s*/g, ' ');
    return normalizedClaim && (normalizedLine.includes(normalizedClaim) || normalizedClaim.includes(normalizedLine));
  });
}

function isVerificationSectionName(name) {
  return VERIFICATION_SECTION_RE.test(String(name || ''));
}

export function detectUnsupportedClaimsOutsideVerification(reportText, options = {}) {
  const verification = verifyReportClaims(reportText, options);
  const blockedClaims = [
    ...verification.unsupported,
    ...verification.unverifiable,
  ].map((item) => item.claim);
  if (blockedClaims.length === 0) return [];

  const findings = [];
  let currentSection = '';
  for (const raw of String(reportText || '').split('\n')) {
    const label = headingLabel(raw);
    if (label) {
      currentSection = label;
      continue;
    }
    if (isVerificationSectionName(currentSection)) continue;
    if (lineMatchesBlockedClaim(raw, blockedClaims)) {
      const match = blockedClaims.find((claim) => lineMatchesBlockedClaim(raw, [claim]));
      findings.push({ claim: match, line: raw.trim(), section: currentSection || 'general' });
    }
  }
  return findings;
}

function stripUnsupportedClaimLines(reportText, findings) {
  if (!findings.length) return String(reportText || '');
  const blockedClaims = findings.map((item) => item.claim);
  const lines = String(reportText || '').split('\n');
  const kept = [];
  let currentSection = '';
  for (const raw of lines) {
    const label = headingLabel(raw);
    if (label) currentSection = label;
    if (!label && !isVerificationSectionName(currentSection) && lineMatchesBlockedClaim(raw, blockedClaims)) continue;
    kept.push(raw);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

function appendPolicyVerificationSection(reportText, policyWarnings) {
  if (!policyWarnings.length) return reportText;
  const lines = [
    reportText.trimEnd(),
    '',
    '## Claim Verification',
    '',
    'Policy warnings:',
    ...policyWarnings.map((warning) => `- ${warning}`),
    '',
  ];
  return lines.join('\n');
}

export function sanitizeEvaluationReport(reportText, options = {}) {
  const application = stripApplicationMaterialSections(reportText);
  const unsupportedFindings = detectUnsupportedClaimsOutsideVerification(application.content, options);
  let content = stripUnsupportedClaimLines(application.content, unsupportedFindings);
  const policyWarnings = [];
  for (let i = 0; i < application.removedSections.length; i++) {
    policyWarnings.push('removed unauthorized application-material section');
  }
  for (let i = 0; i < application.removedContentLines.length; i++) {
    policyWarnings.push('removed unauthorized application-material content');
  }
  for (const finding of unsupportedFindings) {
    policyWarnings.push(`stripped unsupported candidate claim outside verification (${finding.section}): ${finding.claim}`);
  }
  content = appendPolicyVerificationSection(content, policyWarnings);
  return {
    content,
    policyWarnings,
    removedApplicationSections: application.removedSections,
    removedApplicationContentLines: application.removedContentLines,
    removedUnsupportedClaims: unsupportedFindings,
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
