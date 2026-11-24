// Vercel Serverless Function: GET/PUT /api/data  (ข้อมูลหลักของแต่ละบัญชี)
const { redis, auth } = require("./_lib");

const MAX_BYTES = 900 * 1024;

module.exports = async (req, res) => {
  try {
    const user = await auth(req, res);
    if (!user) return;

    if (req.method === "GET") {
      let out = await redis(["GET", user.dataKey]);
      if (!out.result && user.fallback) out = await redis(["GET", user.fallback.dataKey]);
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
      await redis(["SET", user.dataKey, text]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(502).json({ error: "storage error" });
  }
};
