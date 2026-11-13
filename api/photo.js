// Vercel Serverless Function: /api/photo?id=<entry id>
//   GET    -> { data: "data:image/jpeg;base64,..." | null }
//   PUT    -> body { data: "data:image/jpeg;base64,..." }  -> { ok: true }
//   DELETE -> { ok: true }
// ใช้ตัวแปร Environment เดียวกับ api/data.js (SYNC_PASSWORD และค่า Redis)

const crypto = require("crypto");

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const MAX_CHARS = 600 * 1024; // ภาพที่ย่อแล้วปกติเล็กกว่านี้มาก
const ID_RE = /^[a-z0-9]{6,40}$/i;

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return r.json();
}

function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const password = process.env.SYNC_PASSWORD;
  if (!password || !REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: "server not configured" });
  }
  if (!sameSecret(req.headers["x-sync-key"] || "", password)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const id = String((req.query && req.query.id) || "");
  if (!ID_RE.test(id)) return res.status(400).json({ error: "bad id" });
  const key = "tdee:photo:" + id;

  try {
    if (req.method === "GET") {
      const out = await redis(["GET", key]);
      return res.status(200).json({ data: out.result || null });
    }
    if (req.method === "PUT" || req.method === "POST") {
      const data = req.body && req.body.data;
      if (typeof data !== "string" || !data.startsWith("data:image/jpeg;base64,")) {
        return res.status(400).json({ error: "bad body" });
      }
      if (data.length > MAX_CHARS) return res.status(413).json({ error: "too large" });
      await redis(["SET", key, data]);
      return res.status(200).json({ ok: true });
    }
    if (req.method === "DELETE") {
      await redis(["DEL", key]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, PUT, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(502).json({ error: "storage error" });
  }
};
