// Vercel Serverless Function: /api/photo?id=<entry id>  (รูปอาหารของแต่ละบัญชี)
//   GET    -> { data: "data:image/jpeg;base64,..." | null }
//   PUT    -> body { data: "data:image/jpeg;base64,..." } -> { ok: true }
//   DELETE -> { ok: true }
const { redis, auth } = require("./_lib");

const MAX_CHARS = 600 * 1024;
const ID_RE = /^[a-z0-9]{6,40}$/i;

module.exports = async (req, res) => {
  try {
    const user = await auth(req, res);
    if (!user) return;

    const id = String((req.query && req.query.id) || "");
    if (!ID_RE.test(id)) return res.status(400).json({ error: "bad id" });
    const key = user.photoKey(id);

    if (req.method === "GET") {
      let out = await redis(["GET", key]);
      if (!out.result && user.fallback) out = await redis(["GET", user.fallback.photoKey(id)]);
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
      if (user.fallback) await redis(["DEL", user.fallback.photoKey(id)]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, PUT, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(502).json({ error: "storage error" });
  }
};
