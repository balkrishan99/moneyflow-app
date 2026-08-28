import { getCollection } from "../../lib/mongodb.js";
import { normalizeEmail, verifyPassword, createSessionToken, setSessionCookie } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(501).json({ error: "Login isn't configured on this deployment (missing JWT_SECRET)." });
  }

  const { email, password } = req.body || {};
  const normEmail = normalizeEmail(email);
  if (!normEmail || !password) return res.status(400).json({ error: "Enter your email and password." });

  try {
    const accounts = await getCollection("accounts");
    const account = await accounts.findOne({ email: normEmail });

    // Same error for "no such account" and "wrong password" — don't leak
    // which one it was, that just helps someone enumerate valid emails.
    const ok = account && (await verifyPassword(password, account.passwordHash));
    if (!ok) return res.status(401).json({ error: "Incorrect email or password." });

    const token = createSessionToken({ accountId: account.accountId, email: normEmail });
    setSessionCookie(res, token);
    return res.status(200).json({ accountId: account.accountId, email: normEmail, name: account.name });
  } catch (err) {
    console.error("api/auth/login error:", err);
    return res.status(500).json({ error: "Couldn't log you in right now." });
  }
}
