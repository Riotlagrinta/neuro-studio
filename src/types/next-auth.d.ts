import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /** users.id, copied from the token at sign-in. */
    user: { id: string } & DefaultSession["user"];
  }
}
