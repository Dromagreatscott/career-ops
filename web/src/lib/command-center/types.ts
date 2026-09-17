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
  | "REJECTED";

export type AtsType = "greenhouse" | "lever" | "ashby" | "workday" | "unknown";

export type CompensationStatus = "preferred" | "eligible_unknown" | "comp_exception_low_priority" | "unknown";

export type QuestionClassification = "SAFE_AUTOFILL" | "REVIEW_REQUIRED" | "USER_REQUIRED";

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
    label: string;
    path?: string;
    status: "ready" | "pending";
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
  resumeVariants: string[];
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
