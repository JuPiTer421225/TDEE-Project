// Vercel Serverless Function: GET/PUT /api/data
// ต้องตั้ง Environment Variables ในโปรเจกต์ Vercel:
//   SYNC_PASSWORD                      รหัสซิงก์ที่ตั้งเอง
//   KV_REST_API_URL, KV_REST_API_TOKEN (หรือ UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)
//   ซึ่งจะถูกเพิ่มให้อัตโนมัติเมื่อเชื่อม Upstash Redis จาก Marketplace

const crypto = require("crypto");

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = "tdee:data";
const MAX_BYTES = 900 * 1024;

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
  try {
    if (req.method === "GET") {
      const out = await redis(["GET", KEY]);
      return res.status(200).json({ data: out.result ? JSON.parse(out.result) : null });
    }
    if (req.method === "PUT" || req.method === "POST") {
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "bad body" });
      }
      const text = JSON.stringify(body);
      if (Buffer.byteLength(text) > MAX_BYTES) {
        return res.status(413).json({ error: "too large" });
      }
      await redis(["SET", KEY, text]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(502).json({ error: "storage error" });
  }
};
