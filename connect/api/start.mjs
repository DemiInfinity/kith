import { start } from "../lib/broker.mjs";
import { handler, redirect } from "../lib/http.mjs";
export default handler((req, res, s) => redirect(res, start(s, req.query)));
