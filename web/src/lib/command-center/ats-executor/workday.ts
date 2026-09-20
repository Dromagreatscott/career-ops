import { BrowserAtsAdapter } from "./browser-adapter";
import type { ExecutionBlocker, ExecutionContext, InspectedApplication } from "./types";
import { mapPackageFields } from "./field-mapping";

/**
 * Workday executor adapter.
 *
 * Workday postings are account-gated and multi-step: reaching the actual
 * application form almost always requires an existing sign-in, a new candidate
 * account, an emailed verification link, an MFA challenge, or clearing a CAPTCHA.
 * Career Ops NEVER bypasses any of these — it detects the gate, records exactly
 * which one is blocking, pauses the session for David, and only continues after an
 * explicit resume (which the executor gates behind exact package approval again).
 *
 * When a real, ungated application form is reachable, this adapter behaves like the
 * shared browser stack (Greenhouse/Lever/Ashby) and the executor drives the normal
 * dry-run → review → approved-submit path (accountState APPLICATION_READY).
 */

function gate(
  code: ExecutionBlocker["code"],
  message: string,
  action: string,
): ExecutionBlocker {
  return { code, message, action };
}

/**
 * Classify a Workday page into the single most important gate blocking progress.
 *
 * Precedence is safety-first: security controls we must never automate (CAPTCHA,
 * MFA) are surfaced before flow gates (email verification, account creation,
 * login). Flow gates only trip when there is no reachable application form — once
 * the real form's fields are in hand we are already past those gates and must not
 * mistake an "Email" or "Create password" control for a gate. A generic
 * account-gated / multi-step Workday page with no reachable form falls back to a
 * plain user-intervention pause rather than guessing the wrong specific gate.
 *
 * Pure and side-effect free so it can be unit-tested against page fixtures.
 */
export function classifyWorkdayIntervention(inspected: InspectedApplication): ExecutionBlocker | null {
  const hay = [
    inspected.title,
    inspected.url,
    ...inspected.issues.map((issue) => `${issue.code} ${issue.message}`),
  ]
    .join("\n")
    .toLowerCase();

  const hasForm = inspected.fields.length > 0;
  const hasBlockingIssue = inspected.issues.some(
    (issue) => issue.level === "block" || /network_failure|no.?form|login|auth|captcha|challenge|workday|expired/i.test(issue.code),
  );

  // --- Security gates: never bypassed, surfaced even if some fields rendered. ---
  if (/captcha|recaptcha|hcaptcha|challenge|are you human|verify (that )?you.?re human|bot.?check|cloudflare|datadome|px-captcha/.test(hay)) {
    return gate(
      "CAPTCHA_REQUIRED",
      "Workday is presenting a CAPTCHA / human-verification challenge.",
      "Complete the CAPTCHA yourself in the browser, then explicitly resume the session. Career Ops never solves CAPTCHAs.",
    );
  }
  if (/\b(mfa|2fa|multi-?factor|two-?factor|authenticator|one-?time (pass|code)|passcode|\botp\b|security code|authenticate your identity|verification code sent to your (phone|device|mobile))\b/.test(hay)) {
    return gate(
      "MFA_REQUIRED",
      "Workday requires a multi-factor / one-time authentication code.",
      "Complete the MFA challenge yourself, then explicitly resume. Career Ops never handles MFA secrets.",
    );
  }

  // --- Flow gates: only when the real application form is not yet reachable. ---
  if (!hasForm) {
    if (/verify (your )?email|confirm (your )?email|email verification|check your (inbox|email)|activate your account|we.?ve sent .*email|verification link|confirm your account via/.test(hay)) {
      return gate(
        "EMAIL_VERIFICATION_REQUIRED",
        "Workday needs the candidate account's email address verified before the form opens.",
        "Open the verification email and confirm the account, then explicitly resume the session.",
      );
    }
    if (/create (an? )?account|create your (candidate )?account|create (a )?password|sign ?up|\bregister\b|new to workday|set up your (candidate )?account|start your application by creating/.test(hay)) {
      return gate(
        "ACCOUNT_CREATION_REQUIRED",
        "Workday requires creating a candidate account before applying.",
        "Create the candidate account yourself, then explicitly resume the session so Career Ops can continue.",
      );
    }
    if (/sign ?in|log ?in|\blogin\b|welcome back|existing (candidate|account)|already have an account|enter your password|use my existing account/.test(hay)) {
      return gate(
        "LOGIN_REQUIRED",
        "Workday requires signing in to an existing candidate account before applying.",
        "Sign in yourself, then explicitly resume the session. Career Ops never enters stored credentials.",
      );
    }
    if (hasBlockingIssue || /account-gated|multi-?step|myworkdayjobs|workday/.test(hay)) {
      // No specific gate identified, but the account-gated / multi-step flow could
      // not be driven to a form. Pause for manual navigation (maps to the generic
      // USER_INTERVENTION_REQUIRED account state via accountStateForBlocker).
      return gate(
        "UNEXPECTED_ATS_STRUCTURE",
        "Workday's application flow is account-gated / multi-step and could not be reached automatically.",
        "Open the posting, advance to the application form manually, then explicitly resume the session.",
      );
    }
  }

  return null;
}

export class WorkdayAdapter extends BrowserAtsAdapter {
  readonly type = "workday" as const;

  detect(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    // Hosted external career sites: {tenant}.{wdN}.myworkdayjobs.com/...
    if (host === "myworkdayjobs.com" || host.endsWith(".myworkdayjobs.com")) return true;
    // Tenant workday domains and defensive substring match.
    if (host.endsWith(".myworkday.com") || host === "workday.com" || host.endsWith(".workday.com")) return true;
    return /\bmyworkday(jobs)?\b/i.test(host);
  }

  /**
   * Validate a Workday page. If any account/security gate is present, that gate is
   * the only blocker returned so the executor pauses on it and surfaces the exact
   * account state. Otherwise fall back to the shared form/resume validation, which
   * lets a genuinely reachable Workday form proceed to APPLICATION_READY.
   */
  async validate(ctx: ExecutionContext, inspected: InspectedApplication, mappings = mapPackageFields(inspected.fields, ctx.pkg)): Promise<ExecutionBlocker[]> {
    const gateBlocker = classifyWorkdayIntervention(inspected);
    if (gateBlocker) return [gateBlocker];
    return super.validate(ctx, inspected, mappings);
  }
}
