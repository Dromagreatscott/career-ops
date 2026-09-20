import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { AUTH_LOGIN_PATH, operatorUser, operatorUsername, passwordHash } from "@/lib/auth/config";
import { clientIp } from "@/lib/auth/request";
import { checkLoginRateLimit, recordFailedLogin, recordSuccessfulLogin } from "@/lib/auth/rate-limit";

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: AUTH_LOGIN_PATH },
  providers: [
    Credentials({
      name: "Career Ops",
      credentials: {
        username: { label: "Operator", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const username = String(credentials?.username ?? "").trim();
        const password = String(credentials?.password ?? "");
        const ip = clientIp(request);
        const expectedUsername = operatorUsername();
        const expectedHash = passwordHash();

        const limit = checkLoginRateLimit(username || "blank", ip);
        if (limit.limited) return null;
        if (!username || !password || !expectedHash || username !== expectedUsername) {
          recordFailedLogin(username || "blank", ip);
          return null;
        }

        const ok = await compare(password, expectedHash);
        if (!ok) {
          recordFailedLogin(username, ip);
          return null;
        }

        recordSuccessfulLogin(username, ip);
        return operatorUser();
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id ?? "career-ops-operator";
        token.profileScope = user.profileScope || "career-ops";
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.userId || "career-ops-operator",
        profileScope: token.profileScope || "career-ops",
      };
      return session;
    },
  },
});
