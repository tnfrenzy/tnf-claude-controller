import { describe, it, expect } from "vitest";
import { redactSecrets } from "../../src/core/release/redact.js";

describe("redactSecrets extras", () => {
  it("masks credentials in urls", () => {
    expect(redactSecrets("clone https://user:pass@example.com/r.git ok")).toBe("clone https://***@example.com/r.git ok");
    expect(redactSecrets("https://tok@example.com/x")).toBe("https://***@example.com/x");
  });
  it("leaves urls without credentials alone", () => {
    expect(redactSecrets("GET https://example.com/a@b")).toBe("GET https://example.com/a@b");
  });
  it("masks declared key paths in both slash styles", () => {
    const k = "C:\\Users\\me\\.ssh\\deploy_key";
    expect(redactSecrets(`using ${k} now`, [k])).toBe("using [ẩn] now");
    expect(redactSecrets("using C:/Users/me/.ssh/deploy_key now", [k])).toBe("using [ẩn] now");
  });
  it("masks private key blocks", () => {
    const t = "a\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END OPENSSH PRIVATE KEY-----\nb";
    expect(redactSecrets(t)).toBe("a\n[ẩn]\nb");
  });
  it("does not alter ordinary text", () => {
    expect(redactSecrets("deploy ok to deploy@example.com", ["/k/key"])).toBe("deploy ok to deploy@example.com");
  });
});
