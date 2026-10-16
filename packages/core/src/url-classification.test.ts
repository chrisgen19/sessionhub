import { describe, expect, it } from "vitest";
import { classifyUrl, displayUrl } from "./url-classification";

describe("classifyUrl", () => {
  it.each([
    ["https://example.com/a?b=1", "restorable"],
    ["http://localhost:3000/", "restorable"],
    ["HTTPS://EXAMPLE.COM", "restorable"],
    ["chrome://newtab/", "browser-internal"],
    ["chrome://settings", "browser-internal"],
    ["chrome-extension://abcdefghijklmnop/manager.html", "browser-internal"],
    ["about:blank", "browser-internal"],
    ["devtools://devtools/bundled/inspector.html", "browser-internal"],
    ["view-source:https://example.com", "browser-internal"],
    ["file:///C:/Users/me/secret.pdf", "local-file"],
    ["javascript:alert(1)", "unsafe"],
    ["JaVaScRiPt:alert(1)", "unsafe"],
    ["data:text/html,<script>alert(1)</script>", "unsafe"],
    ["blob:https://example.com/uuid", "unsafe"],
    ["mailto:someone@example.com", "unsupported"],
    ["ftp://example.com/file", "unsupported"],
    ["", "invalid"],
    ["not a url", "invalid"],
    ["https://", "invalid"],
  ])("%s -> %s", (url, expected) => {
    expect(classifyUrl(url).eligibility).toBe(expected);
  });

  it("gives a reason for every non-restorable result and none for restorable ones", () => {
    expect(classifyUrl("https://example.com").reason).toBeNull();
    expect(classifyUrl("chrome://settings").reason).toMatch(/browser/i);
  });

  it("rejects urls over the length limit", () => {
    expect(classifyUrl(`https://example.com/${"a".repeat(9000)}`).eligibility).toBe("invalid");
  });
});

describe("displayUrl", () => {
  it("shortens http(s) urls to host and path", () => {
    expect(displayUrl("https://www.example.com/docs/intro?x=1")).toBe("example.com/docs/intro");
    expect(displayUrl("http://localhost:3000/")).toBe("localhost");
  });

  it("returns non-web urls unchanged", () => {
    expect(displayUrl("chrome://settings")).toBe("chrome://settings");
    expect(displayUrl("garbage")).toBe("garbage");
  });
});
