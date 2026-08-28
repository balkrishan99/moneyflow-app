import { getCollection } from "../../lib/mongodb.js";
import { getSession } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Not signed in" });

  try {
    const accounts = await getCollection("accounts");
    const account = await accounts.findOne({ accountId: session.accountId });
    if (!account) return res.status(401).json({ error: "Not signed in" });
    return res.status(200).json({ accountId: account.accountId, email: account.email, name: account.name });
  } catch (err) {
    console.error("api/auth/me error:", err);
    return res.status(500).json({ error: "Couldn't check your session right now." });
  }
}
