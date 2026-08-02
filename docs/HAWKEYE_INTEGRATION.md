# Career Ops and Hawkeye Integration Boundary

This document defines the operating boundary between Career Ops, Hawkeye, and
AIBYS Command Center. Career Ops remains the canonical career engine. Hawkeye
may orchestrate that engine, but must not duplicate or bypass it.

## System Ownership

### Career Ops Owns

- Canonical CV and truth source.
- Profile and preferences.
- Job analysis.
- Canonical 1-5 fit scoring.
- Resume and cover-letter generation.
- Application package production.
- Portal knowledge.
- Tracker state.
- Interview preparation and follow-up workflows.

### Hawkeye Owns

- Scouting.
- Source orchestration.
- Normalization across sources.
- Cross-source deduplication.
- Prioritization.
- Invoking Career Ops.
- Enforcing policy.
- Requesting approvals.
- Orchestrating supported submissions.
- Follow-up monitoring.

### Command Center Owns

- Approval records.
- Mission state.
- Audit events.
- Action authorization.
- Human control.
- Agent visibility.

## Integration Boundary

Hawkeye must invoke Career Ops through a stable CLI or a future API. Career Ops
is the source of truth for profile facts, scoring evidence, generated materials,
and application state.

Hawkeye must not:

- Maintain a second CV.
- Maintain a second career profile.
- Implement a second scoring engine.
- Implement a second resume-tailoring engine.
- Implement a second cover-letter engine.
- Silently alter Career Ops facts.
- Bypass Career Ops truth controls.
- Bypass Command Center approvals.

## Canonical Sources

The current authoritative sources live in this repository. Private values should
remain in local or gitignored files and should not be copied into orchestration
systems.

- `cv.md` - canonical human-readable CV and career truth source.
- `config/profile.yml` - canonical structured profile, preferences, target
  roles, location policy, compensation policy, and output preferences.
- `modes/_profile.md` - candidate-specific archetypes, positioning, scoring
  guidance, stretch-role rules, and durable profile framing.
- `modes/_custom.md` - custom safety rules, workflow constraints, and local
  operating instructions where applicable.
- `portals.yml` - candidate-specific scouting targets, search queries, portal
  configuration, and filter settings.
- `data/applications.md` - canonical application tracker when present.
- `data/pipeline.md` - canonical scouting pipeline when present.
- `reports/` - evaluation reports and application analysis outputs.
- `output/` - generated resumes, cover letters, PDFs, and packages when present.
- Private or gitignored application data where applicable.

## Scoring Policy

Career Ops' 1-5 scoring model remains canonical. Existing guidance:

- `4.5+` - strong.
- `4.0-4.4` - good.
- Below `4.0` - generally not worth applying unless there is a specific
  exceptional reason.

Do not invent a mathematical 0-100 conversion. Hawkeye may later expose a tested
presentation score adapter, but the underlying Career Ops score, report, and
evidence must remain preserved.

### Proposed Future Hawkeye Policy

This policy is proposed only. It is not implemented yet.

- `95-100` presentation score: automatic package preparation; submission
  eligible only if every answer is verified or preapproved and no mandatory
  human-gate question appears.
- `90-94` presentation score: full package preparation; David approval required
  before submission.
- Below `90` presentation score: no automatic submission; watch, archive,
  reject, or route for exceptional review.

## Mandatory Human Gates

David's approval is required regardless of score for:

- Work authorization.
- Sponsorship.
- Demographics.
- Disability.
- Veteran status.
- Criminal history.
- Conflicts of interest.
- Legal attestations.
- Truth certification.
- Compensation commitments.
- Relocation commitments.
- Unsupported facts.
- Unknown questions.
- Unapproved open-ended answers.
- Writing samples not already approved.

## Automatic-Submission Prerequisites

Automatic submission remains disabled until all of these exist and pass testing:

- Approved source adapters.
- Normalized job store.
- Deduplication.
- Verified answer bank.
- Sensitive-question classifier.
- Application-form parser.
- Unsupported-question blocker.
- Portal-specific dry runs.
- Exact preapproval registry.
- Command Center approval bridge.
- Per-application audit trail.
- Daily application limit enforcement.
- Final-submit stop capability.
- Kill switch.

## Definition of Hawkeye Operational

Hawkeye is operational when it can:

- Scout approved sources on schedule.
- Normalize and deduplicate roles.
- Invoke Career Ops for scoring and packages.
- Enforce compensation, geography, fit, and daily limits.
- Route approvals through Command Center.
- Block sensitive, legal, unsupported, or unknown answers.
- Track packages, submissions, and follow-ups.
- Preserve a full audit record.

## Migration Note

The following AIBYS Command Center items are exploratory and non-canonical:

- `/root/aibys-command-center-git/scripts/hawkeye.mjs`
- `/root/aibys-command-center-git/tests/hawkeye.test.ts`
- The related `package.json` Hawkeye script change in Command Center.
- Duplicate Command Center career-profile/bootstrap files.

Useful non-duplicative logic may be migrated later only after
function-by-function comparison against Career Ops. Migration must preserve
Career Ops as the canonical truth, scoring, tailoring, generation, and tracking
engine.
