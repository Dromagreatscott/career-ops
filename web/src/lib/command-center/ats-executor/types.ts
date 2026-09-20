import type { ApplyField } from "@/lib/apply/extract";
import type { ApplicationBlockerCode, ApplicationDryRunReport, ApplicationPackage, ApplicationSession, AtsType, QuestionClassification } from "../types";

export type ExecutorMode = "DRY_RUN" | "LIVE";

export type ExecutionBlocker = {
  code: ApplicationBlockerCode;
  message: string;
  action: string;
  fieldId?: string;
};

export type FieldMapping = {
  field: ApplyField;
  classification: QuestionClassification;
  value?: string;
  source: "profile" | "resume" | "package_question" | "answer_library" | "company_pack" | "unknown";
  status: "mapped" | "missing" | "blocked";
  blocker?: ExecutionBlocker;
};

export type InspectedApplication = {
  title: string;
  url: string;
  applySessionId?: string;
  fields: ApplyField[];
  issues: Array<{ code: string; message: string; level?: string }>;
};

export type ExecutionContext = {
  session: ApplicationSession;
  pkg: ApplicationPackage;
  mode: ExecutorMode;
  dryRunFill: boolean;
};

export type ExecutionResult = {
  status: "DRY_RUN_COMPLETE" | "USER_INTERVENTION_REQUIRED" | "SUBMITTED" | "FAILED";
  report: ApplicationDryRunReport;
  blockers: ExecutionBlocker[];
  confirmation?: {
    id?: string;
    url?: string;
    summary: string;
  };
};

export interface AtsExecutionAdapter {
  readonly type: AtsType;
  detect(url: URL): boolean;
  inspectApplication(ctx: ExecutionContext): Promise<InspectedApplication>;
  startSession(ctx: ExecutionContext): Promise<InspectedApplication>;
  mapFields(ctx: ExecutionContext, inspected: InspectedApplication): Promise<FieldMapping[]>;
  fillFields(ctx: ExecutionContext, inspected: InspectedApplication, mappings: FieldMapping[]): Promise<ExecutionBlocker[]>;
  uploadResume(ctx: ExecutionContext, inspected: InspectedApplication): Promise<ExecutionBlocker | null>;
  validate(ctx: ExecutionContext, inspected: InspectedApplication, mappings: FieldMapping[]): Promise<ExecutionBlocker[]>;
  submit(ctx: ExecutionContext, inspected: InspectedApplication): Promise<ExecutionBlocker | null>;
  captureConfirmation(ctx: ExecutionContext, inspected: InspectedApplication): Promise<ExecutionResult["confirmation"] | null>;
  report?(ctx: ExecutionContext, mappings: FieldMapping[], blockers: ExecutionBlocker[]): ApplicationDryRunReport;
}
