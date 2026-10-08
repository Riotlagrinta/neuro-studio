// Stands in for src/auth.ts: the tests decide who is signed in.
export type TestUser = { id: string; email: string; name?: string } | null;
let current: TestUser = null;
export const setUser = (u: TestUser) => (current = u);
export async function auth() {
  return current ? { user: current } : null;
}
export async function signIn() {}
export async function signOut() {}
