import { describe, expect, it } from "vitest";
import { hostAllowed, hostOf, isPrivateAddress } from "../src/allow.js";

const list = ["en.wikipedia.org", "bbc.co.uk/bitesize", "https://www.thenational.academy/"];
describe("safe list", () => {
  it("allows listed hosts and their subdomains", () => {
    expect(hostAllowed("en.wikipedia.org", list)).toBe(true);
    expect(hostAllowed("www.bbc.co.uk", list)).toBe(true);
    expect(hostAllowed("www.thenational.academy", list)).toBe(true);
  });
  it("refuses everything else", () => {
    expect(hostAllowed("evil.com", list)).toBe(false);
    expect(hostAllowed("wikipedia.org.evil.com", list)).toBe(false);
    expect(hostAllowed("notbbc.co.uk", list)).toBe(false);
    expect(hostAllowed("de.wikipedia.org", list)).toBe(false);
  });
  it("never allows raw IP addresses", () => {
    expect(hostAllowed("192.168.1.50", ["192.168.1.50"])).toBe(false);
  });
  it("reads entries with paths and schemes", () => {
    expect(hostOf("https://www.bbc.co.uk/bitesize/x")).toBe("www.bbc.co.uk");
  });
  it("spots private addresses", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "192.168.1.50", "172.20.1.1", "169.254.1.1", "::1", "fd00::1", "::ffff:192.168.1.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["208.80.154.224", "151.101.0.81", "2a00:1450::1"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("block-list mode", () => {
  it("lets public hosts through, but not blocked ones or blocked words", async () => {
    const { proxyAllows } = await import("../src/allow.js");
    const r = { mode: "blocklist" as const, hosts: ["en.wikipedia.org"], blocked: new Set(["bet365.com"]), words: ["casino"] };
    expect(proxyAllows("www.example.org", r)).toBe(true);
    expect(proxyAllows("www.bet365.com", r)).toBe(false);
    expect(proxyAllows("royal-casino.example", r)).toBe(false);
    expect(proxyAllows("10.0.0.1", r)).toBe(false);
    expect(proxyAllows("kith", r)).toBe(false);
  });
});

describe("addresses that hide a private one", () => {
  it("blocks NAT64, 6to4, IPv4-compatible, site-local, multicast and benchmarking ranges", () => {
    for (const ip of [
      "64:ff9b::a00:1", "64:ff9b::10.0.0.1", "2002:c0a8:101::1", "::10.0.0.1", "::a00:1", "::", "0:0:0:0:0:0:0:1",
      "fec0::1", "ff02::1", "ff00::", "198.18.0.1", "198.19.255.255", "2001::1", "2001:db8::1", "fe80::1%eth0", "::ffff:7f00:1", "not-an-ip",
    ]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["198.20.0.1", "2a00:1450:4009:81f::200e", "2606:4700::6810:84e5", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("block list sets", () => {
  it("checks the big list and the family's list without copying", async () => {
    const { eitherSet, proxyAllows } = await import("../src/allow.js");
    const big = new Set(["bet365.com"]);
    const r = { mode: "blocklist" as const, hosts: [], blocked: eitherSet(big, new Set(["example.net"])), words: [] };
    expect(proxyAllows("www.bet365.com", r)).toBe(false);
    expect(proxyAllows("a.example.net", r)).toBe(false);
    expect(proxyAllows("www.example.org", r)).toBe(true);
  });
});
