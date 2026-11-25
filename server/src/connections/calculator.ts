// A small, safe arithmetic evaluator (no eval). Fractions are kept exact where possible.

type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "fn"; v: string } | { t: "(" } | { t: ")" };

const FNS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: (x) => Math.sin((x * Math.PI) / 180), cos: (x) => Math.cos((x * Math.PI) / 180), tan: (x) => Math.tan((x * Math.PI) / 180),
};

function tokenize(src: string): Tok[] {
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) throw new Error("bad number");
      out.push({ t: "num", v });
      i = j;
    } else if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/i.test(s[j])) j++;
      const name = s.slice(i, j).toLowerCase();
      if (name === "pi") out.push({ t: "num", v: Math.PI });
      else if (FNS[name]) out.push({ t: "fn", v: name });
      else throw new Error(`unknown word "${name}"`);
      i = j;
    } else if ("+-*/^%".includes(c)) {
      const prev = out[out.length - 1];
      const unary = c === "-" && (!prev || prev.t === "op" || prev.t === "(" || prev.t === "fn");
      out.push({ t: "op", v: unary ? "neg" : c });
      i++;
    } else if (c === "(") { out.push({ t: "(" }); i++; }
    else if (c === ")") { out.push({ t: ")" }); i++; }
    else throw new Error(`unexpected "${c}"`);
  }
  return out;
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3, neg: 4 };
const RIGHT = new Set(["^", "neg"]);

export function evaluate(src: string): number {
  if (src.length > 200) throw new Error("too long");
  const output: Tok[] = [];
  const ops: Tok[] = [];
  for (const tok of tokenize(src)) {
    if (tok.t === "num") output.push(tok);
    else if (tok.t === "fn") ops.push(tok);
    else if (tok.t === "op") {
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t === "fn" || (top.t === "op" && (PREC[top.v] > PREC[tok.v] || (PREC[top.v] === PREC[tok.v] && !RIGHT.has(tok.v))))) output.push(ops.pop()!);
        else break;
      }
      ops.push(tok);
    } else if (tok.t === "(") ops.push(tok);
    else {
      while (ops.length && ops[ops.length - 1].t !== "(") output.push(ops.pop()!);
      if (!ops.length) throw new Error("unbalanced brackets");
      ops.pop();
      if (ops.length && ops[ops.length - 1].t === "fn") output.push(ops.pop()!);
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op.t === "(") throw new Error("unbalanced brackets");
    output.push(op);
  }
  const st: number[] = [];
  for (const tok of output) {
    if (tok.t === "num") st.push(tok.v);
    else if (tok.t === "fn") st.push(FNS[tok.v](pop()));
    else if (tok.t === "op") {
      if (tok.v === "neg") { st.push(-pop()); continue; }
      const b = pop(), a = pop();
      st.push(tok.v === "+" ? a + b : tok.v === "-" ? a - b : tok.v === "*" ? a * b : tok.v === "/" ? a / b : tok.v === "%" ? a % b : a ** b);
    }
  }
  if (st.length !== 1) throw new Error("incomplete expression");
  return st[0];
  function pop() {
    const v = st.pop();
    if (v === undefined) throw new Error("incomplete expression");
    return v;
  }
}

function asFraction(x: number): string | null {
  if (Number.isInteger(x) || !Number.isFinite(x)) return null;
  for (let d = 2; d <= 1000; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-9) return `${n}/${d}`;
  }
  return null;
}

export function calculate(expr: string): string {
  try {
    const v = evaluate(expr);
    if (!Number.isFinite(v)) return "That doesn't give a number (maybe dividing by zero?).";
    const rounded = Math.round(v * 1e10) / 1e10;
    const frac = asFraction(rounded);
    return frac ? `${rounded} (= ${frac})` : String(rounded);
  } catch (err) {
    return `I couldn't work that out: ${(err as Error).message}.`;
  }
}
