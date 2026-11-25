import { token } from "../lib/broker.mjs";
import { handler, json } from "../lib/http.mjs";
export default handler(async (req, res, s) => { const r = await token(s, req.body); json(res, r.status, r.body); }, { methods: ["POST"] });
