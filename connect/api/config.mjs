import { publicConfig } from "../lib/broker.mjs";
import { handler, json } from "../lib/http.mjs";
export default handler((req, res, s) => json(res, 200, publicConfig(s)));
