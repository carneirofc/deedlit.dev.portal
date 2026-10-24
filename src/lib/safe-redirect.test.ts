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
    ["relative path", "account"],
    ["a route handler", "/api/auth/signout"],
    ["the api root", "/api"],
    ["a dot-segment climb into the api", "/account/../api/portal/services"],
    ["the login page", "/login"],
    ["the login page with a query", "/login?callbackUrl=/account"],
    ["null byte", "/account\u0000"],
    // The parser would strip this tab and yield `/account/x`; it is refused
    // anyway, because nothing honest needs one.
    ["tab inside a path", "/account/\tx"],
    ["overlong", `/account/${"a".repeat(3000)}`]
  ])("falls back on %s", (_label, raw) => {
    expect(safeCallbackUrl(raw)).toBe(CALLBACK_FALLBACK);
  });

  it("falls back to the dashboard on a missing value", () => {
    expect(CALLBACK_FALLBACK).toBe("/");
    expect(safeCallbackUrl(undefined)).toBe("/");
    expect(safeCallbackUrl("")).toBe("/");
  });

  it("preserves an app path, query and hash exactly", () => {
    expect(safeCallbackUrl("/account?x=1#y")).toBe("/account?x=1#y");
    expect(safeCallbackUrl("/?q=registry")).toBe("/?q=registry");
    // Old bookmarks: next.config redirects these to `/` after sign-in.
    expect(safeCallbackUrl("/portal")).toBe("/portal");
  });

  it("does not treat a lookalike prefix as /login or /api", () => {
    expect(safeCallbackUrl("/loginx")).toBe("/loginx");
    expect(safeCallbackUrl("/apis")).toBe("/apis");
  });

  it("returns the re-serialised path, not the raw input", () => {
    expect(safeCallbackUrl("/account/./a/../b")).toBe("/account/b");
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
    expect(safeAuthRedirect("/account", base)).toBe(`${base}/account`);
    expect(safeAuthRedirect("/", base)).toBe(`${base}/`);
    expect(safeAuthRedirect(`${base}/account?x=1`, base)).toBe(`${base}/account?x=1`);
  });

  it.each([
    "https://evil.example/account",
    "//evil.example",
    "/\t/evil.example",
    "https://portal.deedlit.dev.evil.example/",
    "http://portal.deedlit.dev/account",
    "javascript:alert(1)",
    "not a url"
  ])("sends %s to the base URL", (url) => {
    expect(safeAuthRedirect(url, base)).toBe(base);
  });
});
