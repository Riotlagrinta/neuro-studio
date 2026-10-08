import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { allowedEmail } from "@/lib/allowlist";
import { upsertUser } from "@/lib/users";

// JWT sessions: no session table to maintain. The account row (users) is created at sign-in and
// its id is carried in the token, so every server action can tell who is calling.
// Env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET (+ AUTH_TRUST_HOST=true outside Vercel).
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  pages: { error: "/" }, // failed sign-ins come back as /?error=AccessDenied
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email;
      if (!email || profile?.email_verified !== true) return false;
      return allowedEmail(email);
    },
    async jwt({ token, user }) {
      // `user` is only set at the moment of sign-in.
      if (user?.email) token.uid = await upsertUser({ email: user.email, name: user.name, image: user.image });
      return token;
    },
    async session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});
