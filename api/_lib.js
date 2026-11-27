// ตัวช่วยร่วมของ api/data.js และ api/photo.js (ไฟล์ที่ขึ้นต้นด้วย _ จะไม่ถูกเปิดเป็น endpoint)
//
// Environment Variables:
//   ACCOUNTS       JSON ของบัญชีทั้งหมด เช่น {"somchai":"รหัสผ่าน1","nid":"รหัสผ่าน2"}
//   LEGACY_OWNER   (ไม่บังคับ) ชื่อบัญชีที่จะรับข้อมูลเดิมที่เคยเก็บไว้ก่อนมีระบบบัญชี
//   SYNC_PASSWORD  ใช้เฉพาะโหมดเดิม (รหัสเดียว) เมื่อไม่ได้ตั้ง ACCOUNTS
//   ค่า Redis      KV_REST_API_URL / KV_REST_API_TOKEN (หรือ UPSTASH_REDIS_REST_URL / _TOKEN)

const crypto = require("crypto");

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const MAX_FAILS = 8;       // ผิดได้กี่ครั้งต่อบัญชี
const MAX_FAILS_IP = 24;   // ผิดได้กี่ครั้งต่อ IP
const LOCK_SECONDS = 900;  // ล็อก 15 นาที

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return r.json();
}

function same(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function loadAccounts() {
  if (!process.env.ACCOUNTS) return null;
  try {
    const o = JSON.parse(process.env.ACCOUNTS);
    const m = Object.create(null);
    Object.keys(o).forEach((k) => {
      const name = k.trim().toLowerCase();
      if (name) m[name] = String(o[k]);
    });
    return m;
  } catch (e) {
    return undefined; // ตั้งค่าผิดรูปแบบ
  }
}

// คืนข้อมูลผู้ใช้ หรือส่งคำตอบผิดพลาดแล้วคืน null
async function auth(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(500).json({ error: "server not configured" });
    return null;
  }
  const secret = String(req.headers["x-sync-key"] || "");
  const accounts = loadAccounts();

  if (accounts === undefined) {
    res.status(500).json({ error: "ACCOUNTS is not valid JSON" });
    return null;
  }

  // โหมดเดิม: รหัสเดียว ข้อมูลชุดเดียว
  if (accounts === null) {
    const pw = process.env.SYNC_PASSWORD;
    if (!pw) {
      res.status(500).json({ error: "server not configured" });
      return null;
    }
    if (!same(secret, pw)) {
      res.status(401).json({ error: "unauthorized" });
      return null;
    }
    return { name: "", dataKey: "tdee:data", photoKey: (id) => "tdee:photo:" + id, fallback: null };
  }

  // โหมดบัญชี
  let name = "";
  try {
    name = decodeURIComponent(String(req.headers["x-sync-user"] || ""));
  } catch (e) {}
  name = name.trim().toLowerCase().slice(0, 40);
  const ip = (String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown").trim();
  const kUser = "fail:u:" + encodeURIComponent(name);
  const kIp = "fail:ip:" + ip;

  const known = Object.prototype.hasOwnProperty.call(accounts, name);
  const [a, b] = await Promise.all([redis(["GET", known ? kUser : kIp]), redis(["GET", kIp])]);
  const userFails = known ? Number(a.result) || 0 : 0;
  const ipFails = Number(b.result) || 0;
  if (userFails >= MAX_FAILS || ipFails >= MAX_FAILS_IP) {
    res.status(429).json({ error: "too many attempts" });
    return null;
  }

  if (!known || !same(secret, accounts[name])) {
    if (known) {
      await redis(["INCR", kUser]);
      await redis(["EXPIRE", kUser, LOCK_SECONDS]);
    }
    await redis(["INCR", kIp]);
    await redis(["EXPIRE", kIp, LOCK_SECONDS]);
    res.status(401).json({ error: "unauthorized" });
    return null;
  }

  if (userFails > 0) await redis(["DEL", kUser]);

  const enc = encodeURIComponent(name);
  const legacyOwner = (process.env.LEGACY_OWNER || "").trim().toLowerCase();
  return {
    name,
    dataKey: "u:" + enc + ":data",
    photoKey: (id) => "u:" + enc + ":photo:" + id,
    fallback:
      legacyOwner && legacyOwner === name
        ? { dataKey: "tdee:data", photoKey: (id) => "tdee:photo:" + id }
        : null,
  };
}

module.exports = { redis, auth };
