// Who may use the paid features. Fail-closed: with no configuration, nobody can.
//   ALLOWED_EMAILS=a@x.com,b@y.com   invite-only
//   OPEN_SIGNUP=true                 anyone with a verified account (only once billing exists)

export function allowedEmail(email: string): boolean {
  if (process.env.OPEN_SIGNUP === "true") return true;
  const invited = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return invited.includes(email.trim().toLowerCase());
}

export function authConfigured(): boolean {
  return !!(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
