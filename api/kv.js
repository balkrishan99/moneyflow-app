import { getCollection } from "../lib/mongodb.js";
import { getSession } from "../lib/auth.js";

// NOTE ON ACCESS CONTROL:
// - Keys starting with "mf:user:" hold one person's private financial data.
//   These are locked to the signed-in account that owns them.
// - Keys starting with "mf:group:" hold shared group data. Any signed-in
//   account can read/write any group by id right now (the app doesn't yet
//   track which accounts belong to which group). That's a real step up from
//   "open to the whole internet," but it isn't per-group access control —
//   see the README for how to tighten this further.

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in required." });

  try {
    const collection = await getCollection("kv_store");

    if (req.method === "GET") {
      const { key } = req.query;
      if (!key) return res.status(400).json({ error: "key is required" });
      if (key.startsWith("mf:user:") && key !== `mf:user:${session.accountId}`) {
        return res.status(403).json({ error: "You can't access another account's personal data." });
      }
      const doc = await collection.findOne({ _id: key });
      if (!doc) return res.status(404).json({ error: "not found" });
      return res.status(200).json({ key, value: doc.value });
    }

    if (req.method === "POST") {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: "key is required" });
      if (key.startsWith("mf:user:") && key !== `mf:user:${session.accountId}`) {
        return res.status(403).json({ error: "You can't modify another account's personal data." });
      }
      await collection.updateOne(
        { _id: key },
        { $set: { value, updatedAt: new Date() } },
        { upsert: true }
      );
      return res.status(200).json({ key, ok: true });
    }

    if (req.method === "DELETE") {
      const { key } = req.query;
      if (!key) return res.status(400).json({ error: "key is required" });
      if (key.startsWith("mf:user:") && key !== `mf:user:${session.accountId}`) {
        return res.status(403).json({ error: "You can't modify another account's personal data." });
      }
      await collection.deleteOne({ _id: key });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("api/kv error:", err);
    return res.status(500).json({ error: err.message || "MongoDB storage error." });
  }
}
