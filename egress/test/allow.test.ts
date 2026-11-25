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
