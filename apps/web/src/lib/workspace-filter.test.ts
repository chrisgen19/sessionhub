import { describe, expect, it } from "vitest";
import { NO_WORKSPACE, parseWorkspaceFilter, readSessionsQuery, sessionsHref } from "./workspace-filter";

const mine = "4b1f3c2e-8d7a-4e6b-9c5d-1a2b3c4d5e6f";
const theirs = "5c2a4d3f-9e8b-4f7c-8d6e-2b3c4d5e6f70";

describe("workspace filter", () => {
  it("accepts only the user's own workspaces and 'none'; anything else shows all sessions", () => {
    const own = new Set([mine]);
    expect(parseWorkspaceFilter(mine, own)).toBe(mine);
    expect(parseWorkspaceFilter(NO_WORKSPACE, own)).toBe(NO_WORKSPACE);
    for (const value of [theirs, "", "NONE", undefined, [mine, mine]]) expect(parseWorkspaceFilter(value, own)).toBeNull();
  });

  it("builds list URLs that keep the view, workspace and search, leaving defaults out", () => {
    expect(sessionsHref({ archived: false, query: "", workspace: null })).toBe("/app/sessions");
    expect(sessionsHref({ archived: true, query: "a&b", workspace: mine })).toBe(`/app/sessions?view=archived&workspace=${mine}&q=a%26b`);
    expect(sessionsHref({ archived: false, query: "", workspace: NO_WORKSPACE })).toBe("/app/sessions?workspace=none");
  });

  it("reads the list's search, view and workspace from searchParams, trimmed and bounded", () => {
    expect(readSessionsQuery({})).toEqual({ query: "", archived: false, workspace: null });
    expect(readSessionsQuery({ q: "  docs ", view: "archived", workspace: mine })).toEqual({ query: "docs", archived: true, workspace: mine });
    expect(readSessionsQuery({ q: ["a", "b"], view: "other", workspace: [mine] })).toEqual({ query: "", archived: false, workspace: null });
    expect(readSessionsQuery({ q: "x".repeat(300) }).query).toHaveLength(200);
  });

  it("opens a session beside the same list", () => {
    expect(sessionsHref({ archived: false, query: "", workspace: null, id: mine })).toBe(`/app/sessions/${mine}`);
    expect(sessionsHref({ archived: true, query: "docs", workspace: NO_WORKSPACE, id: mine })).toBe(`/app/sessions/${mine}?view=archived&workspace=none&q=docs`);
  });
});
