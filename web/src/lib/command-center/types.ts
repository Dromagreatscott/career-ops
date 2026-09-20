export type ApplicationStage =
  | "Discovered"
  | "Evaluating"
  | "Qualified"
  | "Preparing"
  | "Needs David"
  | "Ready for Review"
  | "Approved"
  | "Submitting"
  | "Submitted"
  | "Interview"
  | "Closed"
  | "Rejected"
  | "Withdrawn";

export type ApprovalType =
  | "prepare_application"
  | "submit_application"
  | "send_recruiter_message"
  | "send_hiring_manager_message";

export type CompanyTier = 1 | 2 | 3 | null;

export type CompanyPriority = {
  company: string;
  aliases: string[];
  tier: CompanyTier;
  override_enabled: boolean;
  scoring_mode: "role_first" | "company_first";
};

export type Evaluation = {
  status: string;
  score: number | null;
  scoreLabel: string;
  scoreTrust: string;
  recommendation: string;
  summary: string;
  strongestEvidence: string[];
  hardMismatches: string[];
  reportNumber?: string;
  reportFile?: string;
};

export type Job = {
  id: string;
  company: string;
  title: string;
  location?: string;
  compensation?: string;
  postedDate?: string;
  discoveredDate?: string;
  workArrangement?: string;
  source: string;
  applicationPlatform: string;
  sourceUrl: string;
  canonicalApplyUrl?: string;
  canonicalApplyStatus: "resolved" | "needs_resolution";
  fitScore: number | null;
  fitSummary: string;
  evaluation?: Evaluation;
  companyPriority: CompanyPriority;
  dreamCompany: boolean;
  stage: ApplicationStage;
  trackerNumber?: string;
  status?: string;
  reportHref?: string;
  rawNotes?: string;
};

export type Application = {
  id: string;
  jobId?: string;
  trackerNumber?: string;
  company: string;
  title: string;
  stage: ApplicationStage;
  status: string;
  score: number | null;
  scoreLabel: string;
  canonicalApplyUrl?: string;
  sourceUrl?: string;
  reportHref?: string;
  notes?: string;
  updatedDate?: string;
  applicationPackage?: ApplicationPackage;
};

export type ApplicationPackageStatus =
  | "DISCOVERED"
  | "EVALUATING"
  | "QUALIFIED"
  | "PREPARING"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "USER_INTERVENTION_REQUIRED"
  | "INTERVIEW"
  | "CLOSED"
  | "REJECTED"
  | "FAILED";

export type AtsType = "greenhouse" | "lever" | "ashby" | "workday" | "unknown";

export type ApplicationSessionMode = "DRY_RUN" | "LIVE";

export type ApplicationSessionStatus =
  | "SUBMITTING"
  | "DRY_RUN_COMPLETE"
  | "USER_INTERVENTION_REQUIRED"
  | "SUBMITTED"
  | "FAILED";

export type ApplicationAccountState =
  | "NO_ACCOUNT_REQUIRED"
  | "ACCOUNT_REQUIRED"
  | "ACCOUNT_EXISTS_AUTHENTICATED"
  | "ACCOUNT_EXISTS_LOGIN_REQUIRED"
  | "ACCOUNT_CREATION_REQUIRED"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "MFA_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "USER_INTERVENTION_REQUIRED"
  | "APPLICATION_READY";

export type ApplicationBlockerCode =
  | "CAPTCHA_REQUIRED"
  | "MFA_REQUIRED"
  | "LOGIN_REQUIRED"
  | "ACCOUNT_CREATION_REQUIRED"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "UNKNOWN_REQUIRED_FIELD"
  | "USER_REQUIRED_FIELD"
  | "UNSUPPORTED_WIDGET"
  | "UNEXPECTED_ATS_STRUCTURE"
  | "RESUME_VERSION_MISMATCH"
  | "STALE_APPROVAL"
  | "NETWORK_FAILURE"
  | "CONFIRMATION_UNVERIFIED"
  | "UNSUPPORTED_ATS"
  | "BAD_APPLICATION_URL"
  | "DUPLICATE_SUBMISSION"
  | "MISSING_RESUME";

export type ApplicationSessionAuditEvent = {
  timestamp: string;
  type:
    | "SESSION_CREATED"
    | "ATS_DETECTED"
    | "FORM_INSPECTED"
    | "FIELD_MAPPED"
    | "FIELD_FILLED"
    | "RESUME_UPLOADED"
    | "VALIDATION_COMPLETED"
    | "VALIDATION_FAILED"
    | "DRY_RUN_COMPLETED"
    | "USER_INTERVENTION_REQUIRED"
    | "EXECUTION_RESUMED"
    | "SUBMISSION_ATTEMPTED"
    | "CONFIRMATION_OBSERVED"
    | "SUBMITTED"
    | "FAILED";
  summary: string;
  fieldId?: string;
  status?: string;
};

export type ApplicationSession = {
  id: string;
  userId: string;
  profileScope: string;
  applicationPackageId: string;
  applicationPackageVersion: number;
  applicationPackageHash: string;
  atsType: AtsType;
  applicationUrl: string;
  canonicalUrl: string;
  mode: ApplicationSessionMode;
  status: ApplicationSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastStep?: string;
  lastErrorCode?: ApplicationBlockerCode;
  requiresUserAction: boolean;
  userActionMessage?: string;
  accountState: ApplicationAccountState;
  confirmationId?: string;
  confirmationUrl?: string;
  confirmationSummary?: string;
  submittedAt?: string;
  dryRunReport?: ApplicationDryRunReport;
  auditEvents: ApplicationSessionAuditEvent[];
};

export type ApplicationDryRunReport = {
  ats: AtsType;
  fieldsFound: number;
  safeAutofill: string[];
  reviewRequired: string[];
  userRequired: string[];
  unknownRequired: string[];
  resume: "READY" | "MISSING" | "VERSION_MISMATCH";
  validation: "READY" | "BLOCKED" | "FAILED";
  readyForLiveSubmission: boolean;
  blockers: Array<{ code: ApplicationBlockerCode; message: string; action: string }>;
};

export type CompensationStatus = "preferred" | "eligible_unknown" | "comp_exception_low_priority" | "unknown";

export type QuestionClassification = "SAFE_AUTOFILL" | "REVIEW_REQUIRED" | "USER_REQUIRED";

export type VerificationState = "verified" | "needs_review" | "missing";

export type ProfileField<T = string> = {
  value: T;
  verificationState: VerificationState;
  updatedAt?: string;
};

export type ProfileVerificationItem = {
  id: string;
  label: string;
  status: VerificationState;
  source: string;
  detail?: string;
  updatedAt?: string;
};

export type ReusableApplicationAnswer = {
  id: string;
  userId?: string;
  profileScope?: string;
  scope?: "universal" | "company" | "role";
  company?: string;
  answerType?: string;
  label: string;
  title?: string;
  value: string;
  content?: string;
  category: "authorization" | "location" | "compensation" | "logistics" | "narrative";
  verification: VerificationState;
  verificationState?: VerificationState;
  classification?: QuestionClassification;
  safeToAutofill: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastReviewedAt?: string;
  isArchived?: boolean;
};

export type ResumeLibraryItem = {
  id: string;
  userId?: string;
  profileScope?: string;
  label: string;
  name?: string;
  category?: string;
  version?: number;
  originalFilename?: string;
  path: string;
  storageRef?: string;
  format: "pdf" | "docx" | "html" | "md" | "txt" | "other";
  status: "ready" | "missing";
  isDefault: boolean;
  isArchived?: boolean;
  recommendedFor: string[];
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CompanyAnswerPackEntry = {
  id: string;
  answerType: string;
  title: string;
  content: string;
  length?: "short" | "medium" | "long";
  useCase?: string;
  classification: QuestionClassification;
  verificationState: VerificationState;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt?: string;
  isArchived?: boolean;
};

export type CompanyAnswerPack = {
  id: string;
  userId: string;
  profileScope: string;
  company: string;
  aliases: string[];
  entries: CompanyAnswerPackEntry[];
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
};

export type ApplicationQuestion = {
  id: string;
  label: string;
  classification: QuestionClassification;
  value?: string;
  draft?: string;
  source: "profile" | "career_ops" | "user";
  explanation: string;
};

export type ApplicationPackage = {
  id: string;
  schemaVersion: 1;
  jobId: string;
  trackerNumber?: string;
  version: number;
  packageHash: string;
  company: string;
  title: string;
  status: ApplicationPackageStatus;
  approvalRequired: ApprovalType;
  submitApprovalRequired: ApprovalType;
  materialSummary: string;
  atsType: AtsType;
  canonicalJobUrl: string;
  baseRoleFit: number | null;
  compensationStatus: CompensationStatus;
  roleFitExplanation: string[];
  selectedResume: {
    id?: string;
    label: string;
    path?: string;
    status: "ready" | "pending";
    version?: number;
    selection?: "recommended" | "override";
    recommendationReason?: string;
    overrideReason?: string;
  };
  userId?: string;
  profileScope?: string;
  profileSnapshot?: {
    version: number;
    hash: string;
    reference: string;
  };
  reusableAnswerRefs?: Array<{
    id: string;
    version?: number;
    classification: QuestionClassification;
    hash: string;
  }>;
  companyAnswerRefs?: Array<{
    packId: string;
    entryId: string;
    classification: QuestionClassification;
    hash: string;
  }>;
  packageIssues?: {
    missingFields: string[];
    reviewRequiredFields: string[];
    userRequiredFields: string[];
    warnings: string[];
  };
  tailoredResumeChanges: string[];
  coverLetter: {
    useful: boolean;
    status: "ready" | "not_needed" | "pending";
    draft?: string;
  };
  questions: ApplicationQuestion[];
  outreachDraft?: {
    channel: "linkedin_dm" | "email";
    body: string;
    status: "draft_ready" | "pending";
  };
  approval?: {
    status: "approved" | "rejected";
    packageHash: string;
    decidedAt: string;
  };
  canonicalApplyUrl?: string;
  reportHref?: string;
  createdAt: string;
  updatedAt: string;
};

export type Outreach = {
  id: string;
  jobId?: string;
  company: string;
  role?: string;
  targetType: "hiring_manager" | "recruiter" | "linkedin_dm" | "cold_dm" | "follow_up" | "application_follow_up";
  targetName?: string;
  status: "not_started" | "draft_needed" | "draft_ready" | "approved" | "sent" | "not_connected";
  approvalRequired: ApprovalType;
};

export type Approval = {
  type: ApprovalType;
  status: "required" | "approved" | "rejected" | "not_requested";
  targetId?: string;
};

export type AuditEvent = {
  timestamp: string;
  type: string;
  actor?: string;
  targetId?: string;
  summary: string;
};

export type EmploymentHistoryItem = {
  organization: string;
  location?: string;
  title?: string;
  dates?: string;
  highlights: string[];
};

export type EducationItem = {
  label: string;
  details?: string;
};

export type ProfileView = {
  userId?: string;
  profileScope?: string;
  version?: number;
  snapshotHash?: string;
  contact: {
    fullName?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    portfolioUrl?: string;
    github?: string;
  };
  employmentHistory: EmploymentHistoryItem[];
  education: EducationItem[];
  portfolio: string[];
  preferredRoles: string[];
  salaryTarget?: string;
  geographicPreferences?: string;
  standardAnswers: Record<string, string>;
  reusableAnswers: ReusableApplicationAnswer[];
  verification: ProfileVerificationItem[];
  resumeVariants: string[];
  resumeLibrary: ResumeLibraryItem[];
  companyAnswerPacks?: CompanyAnswerPack[];
  dreamCompanies: CompanyPriority[];
  excludedRoleTypes: string[];
};

export type CommandCenterData = {
  jobs: Job[];
  applications: Application[];
  applicationPackages: ApplicationPackage[];
  outreach: Outreach[];
  approvals: Approval[];
  auditEvents: AuditEvent[];
  profile: ProfileView;
};
