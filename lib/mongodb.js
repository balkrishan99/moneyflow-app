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

export async function getDb() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is missing.");
  }
  const client = await cachedClient;
  return client.db(process.env.MONGODB_DB_NAME || "moneyflow");
}

export async function getCollection(name) {
  const db = await getDb();
  return db.collection(name);
}

// Called lazily so we don't need a separate migration step. Safe to call
// repeatedly — createIndex is a no-op if the index already exists.
let indexesEnsured = false;
export async function ensureAccountIndexes() {
  if (indexesEnsured) return;
  const accounts = await getCollection("accounts");
  await accounts.createIndex({ email: 1 }, { unique: true });
  indexesEnsured = true;
}
