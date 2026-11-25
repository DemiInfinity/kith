import { refresh } from "../lib/broker.mjs";
import { handler, json } from "../lib/http.mjs";
export default handler(async (req, res, s) => { const r = await refresh(s, req.body); json(res, r.status, r.body); }, { methods: ["POST"] });
