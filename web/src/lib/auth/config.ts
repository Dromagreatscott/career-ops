export const AUTH_LOGIN_PATH = "/login";
export const AUTH_DEFAULT_REDIRECT = "/";
export const AUTH_PROFILE_SCOPE = "career-ops";

export type CareerOpsUser = {
  id: string;
  name: string;
  email: string;
  profileScope: string;
};

export function operatorUsername(): string {
  return process.env.CAREER_OPS_OPERATOR_USERNAME?.trim() || "operator";
}

export function operatorUser(): CareerOpsUser {
  const username = operatorUsername();
  return {
    id: process.env.CAREER_OPS_OPERATOR_ID?.trim() || "career-ops-operator",
    name: process.env.CAREER_OPS_OPERATOR_NAME?.trim() || "Career Ops Operator",
    email: process.env.CAREER_OPS_OPERATOR_EMAIL?.trim() || `${username}@career-ops.local`,
    profileScope: process.env.CAREER_OPS_PROFILE_SCOPE?.trim() || AUTH_PROFILE_SCOPE,
  };
}

export function passwordHash(): string | null {
  const value = process.env.CAREER_OPS_OPERATOR_PASSWORD_HASH?.trim();
  return value || null;
}

export function authConfigured(): boolean {
  return Boolean(passwordHash() && (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET));
}

