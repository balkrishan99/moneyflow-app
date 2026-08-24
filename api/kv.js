import { MongoClient } from "mongodb";
import { attachDatabasePool } from "@vercel/functions";

const uri = process.env.MONGODB_URI;
let cachedClient = global._mongoClientPromise;

if (!cachedClient && uri) {
  const client = new MongoClient(uri);
  try {
    attachDatabasePool(client);
  } catch (e) {
    // attachDatabasePool fallback if running locally
  }
  cachedClient = client.connect();
  global._mongoClientPromise = cachedClient;
}

async function getCollection() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is missing.");
  }
  const client = await cachedClient;
  const db = client.db(process.env.MONGODB_DB_NAME || "moneyflow");
  return db.collection("kv_store");
}

export default async function handler(req, res) {
  try {
    const collection = await getCollection();

    if (req.method === "GET") {
      const { key } = req.query;
      if (!key) return res.status(400).json({ error: "key is required" });
      const doc = await collection.findOne({ _id: key });
      if (!doc) return res.status(404).json({ error: "not found" });
      return res.status(200).json({ key, value: doc.value });
    }

    if (req.method === "POST") {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: "key is required" });
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

