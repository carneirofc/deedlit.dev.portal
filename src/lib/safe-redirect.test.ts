import { describe, expect, it } from "vitest";
import { CALLBACK_FALLBACK, safeAuthRedirect, safeCallbackUrl, sameOriginPath } from "./safe-redirect";

describe("safeCallbackUrl", () => {
  // Query-decoded values, i.e. what `searchParams.callbackUrl` holds.
  it.each([
    ["tab", "/\t/evil.example"],
    ["LF", "/\n/evil.example"],
    ["CR", "/\r/evil.example"],
    ["protocol-relative", "//evil.example"],
    ["backslash", "/\\evil.example"],
    ["encoded backslash", "/%5Cevil.example"],
    ["absolute URL", "https://evil.example"],
    ["javascript: URL", "javascript:alert(1)"],
    ["encoded slashes", "/%2F%2Fevil.example"],
    ["triple slash", "///evil.example"],
    ["relative path", "portal"],
    ["same-origin but outside the portal", "/api/auth/signout"],
    ["prefix lookalike", "/portalevil"],
    ["null byte", "/portal\u0000"],
    // The parser would strip this tab and yield `/portal/x`; it is refused
    // anyway, because nothing honest needs one.
    ["tab inside a portal path", "/portal/\tx"],
    ["overlong", `/portal/${"a".repeat(3000)}`]
  ])("falls back on %s", (_label, raw) => {
    expect(safeCallbackUrl(raw)).toBe(CALLBACK_FALLBACK);
  });

  it("falls back on a missing value", () => {
    expect(safeCallbackUrl(undefined)).toBe("/portal");
    expect(safeCallbackUrl("")).toBe("/portal");
  });

  it("preserves a portal path, query and hash exactly", () => {
    expect(safeCallbackUrl("/portal?x=1#y")).toBe("/portal?x=1#y");
    expect(safeCallbackUrl("/portal/services")).toBe("/portal/services");
  });

  it("returns the re-serialised path, not the raw input", () => {
    expect(safeCallbackUrl("/portal/./a/../b")).toBe("/portal/b");
  });
});

describe("sameOriginPath", () => {
  it("admits any same-origin path", () => {
    expect(sameOriginPath("/")).toBe("/");
    expect(sameOriginPath("/login?error=x")).toBe("/login?error=x");
  });

  it("refuses dot segments that climb to a protocol-relative path", () => {
    expect(sameOriginPath("/..//evil.example")).toBeNull();
  });
});

describe("safeAuthRedirect", () => {
  const base = "https://portal.deedlit.dev";

  it("keeps same-origin relative and absolute targets", () => {
    expect(safeAuthRedirect("/portal", base)).toBe(`${base}/portal`);
    expect(safeAuthRedirect("/", base)).toBe(`${base}/`);
    expect(safeAuthRedirect(`${base}/portal?x=1`, base)).toBe(`${base}/portal?x=1`);
  });

  it.each([
    "https://evil.example/portal",
    "//evil.example",
    "/\t/evil.example",
    "https://portal.deedlit.dev.evil.example/",
    "http://portal.deedlit.dev/portal",
    "javascript:alert(1)",
    "not a url"
  ])("sends %s to the base URL", (url) => {
    expect(safeAuthRedirect(url, base)).toBe(base);
  });
});
