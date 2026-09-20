import { BrowserAtsAdapter } from "./browser-adapter";
import { mapPackageFields } from "./field-mapping";
import type { ApplyField } from "@/lib/apply/extract";
import type { ExecutionBlocker, ExecutionContext, FieldMapping, InspectedApplication } from "./types";

/**
 * Generic / manual-assist fallback adapter for ATS pages Career Ops does not have
 * a first-class adapter for.
 *
 * It reuses the shared apply/session browser stack to inspect standard form
 * controls and map the known-safe fields, and will optionally pre-fill ONLY
 * SAFE_AUTOFILL fields (verified contact details + the approved résumé). Anything
 * it cannot recognise — comboboxes/selects whose valid values it cannot enumerate,
 * unknown required fields, review-required narrative — is flagged, not guessed, and
 * the session pauses so David can finish in the browser. It never claims an
 * unsupported structure is fully automated and never auto-submits.
 *
 * Its `type` is "unknown" (the AtsType has no dedicated "generic" member), so ATS
 * detection still reports "unknown" for these pages while the executor now gets a
 * working adapter instead of a hard UNSUPPORTED_ATS stop.
 */

/**
 * A widget whose valid values we cannot safely enumerate/select without guessing:
 * a react-select-style combobox or a native <select> with no known options. Filling
 * these blind risks submitting a wrong/ambiguous answer, so we stop instead.
 */
function isUnsupportedWidget(field: ApplyField): boolean {
  const noOptions = !field.options || field.options.length === 0;
  if (field.combobox && noOptions) return true;
  if (field.type === "select" && noOptions) return true;
  return false;
}

export class GenericAtsAdapter extends BrowserAtsAdapter {
  readonly type = "unknown" as const;
  readonly isGenericFallback = true as const;

  // Fallback: matches any URL the executor lets through (URL safety/SSRF is already
  // enforced upstream). Kept last in the adapter list so specific adapters win.
  detect(_url: URL): boolean {
    return true;
  }

  /**
   * Only ever fill SAFE_AUTOFILL fields. Review-required and user-required values
   * are withheld here (their value is stripped before delegating) so the generic
   * path never auto-enters an ambiguous or sensitive answer on an unknown form.
   */
  async fillFields(ctx: ExecutionContext, inspected: InspectedApplication, mappings = mapPackageFields(inspected.fields, ctx.pkg)): Promise<ExecutionBlocker[]> {
    const safeOnly: FieldMapping[] = mappings.map((mapping) =>
      mapping.classification === "SAFE_AUTOFILL" ? mapping : { ...mapping, value: undefined },
    );
    return super.fillFields(ctx, inspected, safeOnly);
  }

  /**
   * Base form/resume/mapping validation PLUS explicit unsupported-widget blockers.
   * Any of these keeps the session in USER_INTERVENTION_REQUIRED so David finishes
   * manually.
   */
  async validate(ctx: ExecutionContext, inspected: InspectedApplication, mappings = mapPackageFields(inspected.fields, ctx.pkg)): Promise<ExecutionBlocker[]> {
    const base = await super.validate(ctx, inspected, mappings);
    const widgets: ExecutionBlocker[] = inspected.fields
      .filter(isUnsupportedWidget)
      .map((field) => ({
        code: "UNSUPPORTED_WIDGET" as const,
        message: `Unsupported widget on an unrecognised ATS: ${field.label || field.id}`,
        action: "Fill this control yourself in the browser before submitting.",
        fieldId: field.id,
      }));
    return [...base, ...widgets];
  }

  /**
   * Never auto-submit an unrecognised ATS. Always returns an intervention blocker
   * so the executor stops before submission and hands off to David.
   */
  async submit(): Promise<ExecutionBlocker> {
    return {
      code: "UNSUPPORTED_ATS",
      message: "Career Ops will not auto-submit an unrecognised ATS form.",
      action: "Review the pre-filled fields and submit the application yourself in the browser.",
    };
  }
}
