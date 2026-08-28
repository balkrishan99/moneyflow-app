import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { serialize, parse } from "cookie";

const COOKIE_NAME = "mf_session";
const SESSION_DAYS = 30;

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET environment variable is missing.");
  return s;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export function createSessionToken(payload) {
  return jwt.sign(payload, secret(), { expiresIn: `${SESSION_DAYS}d` });
}
export function verifySessionToken(token) {
  try {
    return jwt.verify(token, secret());
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  const cookieStr = serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true, // Vercel deployments are always HTTPS
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
  res.setHeader("Set-Cookie", cookieStr);
}

export function clearSessionCookie(res) {
  const cookieStr = serialize(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  res.setHeader("Set-Cookie", cookieStr);
}

// Returns { accountId, email } or null. Never throws.
export function getSession(req) {
  try {
    const cookies = parse(req.headers.cookie || "");
    const token = cookies[COOKIE_NAME];
    if (!token) return null;
    return verifySessionToken(token);
  } catch {
    return null;
  }
}
