import type { BuildSessionOptions, CaptureTabInput } from "./capture";

/** Deterministic RFC 4122 v4-shaped ids for tests. */
export const sequentialIds = (): (() => string) => {
  let next = 0;
  return () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`;
};

export const tab = (index: number, url: string, extra: Partial<CaptureTabInput> = {}): CaptureTabInput => ({
  url,
  title: `Tab ${index}`,
  pinned: false,
  index,
  groupKey: null,
  ...extra,
});

export const options = (overrides: Partial<BuildSessionOptions> = {}): BuildSessionOptions => ({
  name: "Test session",
  now: new Date("2026-10-16T08:00:00.000Z"),
  device: { id: "0d6f6a4e-2f0c-4a43-8f5b-2a7e9a0c1d11", name: "This device" },
  createId: sequentialIds(),
  ...overrides,
});
