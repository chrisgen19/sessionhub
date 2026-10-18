import { describe, expect, it } from "vitest";
import { hostMark } from "./host-mark";

describe("host mark", () => {
  it("is the host's first letter, the same for every page of a site, www. or not", () => {
    const docs = hostMark("https://react.dev/learn");
    expect(docs?.letter).toBe("R");
    expect(hostMark("https://react.dev/reference/react")).toEqual(docs);
    expect(hostMark("https://www.github.com/a")).toEqual(hostMark("https://github.com/b"));
    expect(hostMark("http://123.example/")?.letter).toBe("1");
  });

  it("picks only colors white text stays legible on", () => {
    const hosts = ["a.test", "b.test", "github.com", "figma.com", "claude.ai", "mail.google.com", "x.org", "news.ycombinator.com"];
    for (const host of hosts) expect(["grey", "yellow"]).not.toContain(hostMark(`https://${host}/`)?.color);
  });

  it("is null for browser pages, files and other links that aren't web pages", () => {
    for (const url of ["chrome://settings", "file:///tmp/a.html", "about:blank", "javascript:alert(1)", "not a url"]) expect(hostMark(url)).toBeNull();
  });
});
