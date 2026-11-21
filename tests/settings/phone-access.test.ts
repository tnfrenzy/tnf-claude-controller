import { describe, expect, it } from "vitest";
import { disableServe, enableServe, isServing, parseStatus, phoneInfo, type Runner } from "../../src/core/app/phone-access.js";

const runner = (answers: Record<string, { code: number; stdout?: string; stderr?: string }>): Runner => (_exe, args) => {
  const a = answers[args.join(" ")] ?? { code: 1, stderr: "unexpected " + args.join(" ") };
  return { code: a.code, stdout: a.stdout ?? "", stderr: a.stderr ?? "" };
};

describe("parseStatus / isServing", () => {
  it("reads the tailnet name and running state", () => {
    expect(parseStatus({ BackendState: "Running", Self: { DNSName: "Desktop-X.tail1.ts.net." } })).toEqual({ running: true, dnsName: "desktop-x.tail1.ts.net" });
    expect(parseStatus({ BackendState: "NeedsLogin", Self: { DNSName: "a.ts.net." } }).running).toBe(false);
    expect(parseStatus(null)).toEqual({ running: false, dnsName: null });
    expect(parseStatus({ BackendState: "Running", Self: { DNSName: "bad name!" } }).dnsName).toBeNull();
  });
  it("detects the proxied port", () => {
    const cfg = { Web: { "x.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4800" } } } } };
    expect(isServing(cfg, 4800)).toBe(true);
    expect(isServing(cfg, 4801)).toBe(false);
    expect(isServing({}, 4800)).toBe(false);
  });
});

describe("phoneInfo", () => {
  const status = JSON.stringify({ BackendState: "Running", Self: { DNSName: "pc.tail1.ts.net." } });
  const serve = JSON.stringify({ Web: { "pc.tail1.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4800" } } } } });
  it("is not installed without the CLI", () => {
    expect(phoneInfo({ port: 4800, token: "t", origins: [], exe: null }).installed).toBe(false);
  });
  it("gives the link only when serving and the origin is allowed", () => {
    const run = runner({ "status --json": { code: 0, stdout: status }, "serve status --json": { code: 0, stdout: serve } });
    const off = phoneInfo({ port: 4800, token: "tok", origins: [], exe: "ts", run });
    expect(off).toMatchObject({ running: true, serving: true, allowed: false, link: null, origin: "https://pc.tail1.ts.net" });
    const on = phoneInfo({ port: 4800, token: "tok", origins: ["https://pc.tail1.ts.net"], exe: "ts", run });
    expect(on.link).toBe("https://pc.tail1.ts.net/#token=tok");
  });
});

describe("enable / disable serve", () => {
  it("succeeds, retries without --yes on old CLIs, and relays the HTTPS hint", () => {
    expect(enableServe("ts", 4800, runner({ "serve --bg --yes 4800": { code: 0 } })).ok).toBe(true);
    expect(enableServe("ts", 4800, runner({ "serve --bg --yes 4800": { code: 1, stderr: "unknown flag: --yes" }, "serve --bg 4800": { code: 0 } })).ok).toBe(true);
    const r = enableServe("ts", 4800, runner({ "serve --bg --yes 4800": { code: 1, stderr: "Serve is not enabled. Visit: https://login.tailscale.com/f/serve?node=abc" } }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("https://login.tailscale.com/f/serve?node=abc");
  });
  it("turns it off", () => {
    expect(disableServe("ts", runner({ "serve --https=443 off": { code: 0 } })).ok).toBe(true);
    expect(disableServe("ts", runner({})).ok).toBe(false);
  });
});
