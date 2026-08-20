import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "aeo_admin_preview";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const user = verifySessionCookie(req);
    return res.status(200).json({
      enabled: isPreviewEnabled(),
      authenticated: Boolean(user),
      user,
    });
  }

  if (req.method === "POST") {
    if (!isPreviewEnabled()) {
      return res.status(503).json({
        error: "Admin preview is not configured.",
      });
    }

    const body = await readJsonBody(req);
    const passcode = String(body.passcode || "");

    if (!safeEqualString(passcode, process.env.ADMIN_PREVIEW_PASSWORD || "")) {
      return res.status(401).json({
        error: "Invalid admin preview passcode.",
      });
    }

    const user = {
      email: process.env.ADMIN_PREVIEW_EMAIL || "admin-preview@aeolocal.test",
      role: "admin-preview",
    };

    res.setHeader("Set-Cookie", buildSessionCookie(createSessionToken(user), req));
    return res.status(200).json({
      authenticated: true,
      user,
    });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearSessionCookie(req));
    return res.status(200).json({ authenticated: false });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

function isPreviewEnabled() {
  return Boolean(process.env.ADMIN_PREVIEW_PASSWORD);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length > 0) {
    return JSON.parse(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function createSessionToken(user) {
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: "admin-preview",
      email: user.email,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
    })
  );

  return `${payload}.${signPayload(payload)}`;
}

function verifySessionCookie(req) {
  const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  if (!safeEqualString(signature, signPayload(payload))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      email: session.email || "admin-preview@aeolocal.test",
      role: session.role || "admin-preview",
    };
  } catch {
    return null;
  }
}

function signPayload(payload) {
  return createHmac("sha256", getSigningSecret()).update(payload).digest("base64url");
}

function getSigningSecret() {
  return process.env.ADMIN_PREVIEW_SECRET || process.env.ADMIN_PREVIEW_PASSWORD || "";
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) return cookies;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function buildSessionCookie(token, req) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    shouldUseSecureCookie(req) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function clearSessionCookie(req) {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    shouldUseSecureCookie(req) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function shouldUseSecureCookie(req) {
  return Boolean(process.env.VERCEL || req.headers["x-forwarded-proto"] === "https");
}
