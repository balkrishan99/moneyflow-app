import { randomUUID } from "node:crypto";
import { getCollection, ensureAccountIndexes } from "../../lib/mongodb.js";
import { normalizeEmail, hashPassword, createSessionToken, setSessionCookie } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(501).json({ error: "Sign-up isn't configured on this deployment (missing JWT_SECRET)." });
  }

  const { email, password, name } = req.body || {};
  const normEmail = normalizeEmail(email);

  if (!normEmail || !normEmail.includes("@")) return res.status(400).json({ error: "Enter a valid email address." });
  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (!name || !name.trim()) return res.status(400).json({ error: "Enter a display name." });

  try {
    await ensureAccountIndexes();
    const accounts = await getCollection("accounts");

    const existing = await accounts.findOne({ email: normEmail });
    if (existing) return res.status(409).json({ error: "An account with that email already exists. Try logging in instead." });

    const accountId = randomUUID();
    const passwordHash = await hashPassword(password);
    await accounts.insertOne({
      accountId,
      email: normEmail,
      name: name.trim(),
      passwordHash,
      createdAt: new Date().toISOString(),
    });

    const token = createSessionToken({ accountId, email: normEmail });
    setSessionCookie(res, token);
    return res.status(200).json({ accountId, email: normEmail, name: name.trim() });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: "An account with that email already exists. Try logging in instead." });
    console.error("api/auth/signup error:", err);
    return res.status(500).json({ error: "Couldn't create your account right now." });
  }
}
