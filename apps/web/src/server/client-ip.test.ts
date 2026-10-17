import { describe, expect, it } from "vitest";
import { clientAddressFrom, rateLimitSubject } from "./client-ip";

describe("clientAddressFrom", () => {
  it("takes the entry the trusted proxy appended, never the client-supplied part", () => {
    // Traefik appends the address it saw: whatever the client sent stays on the left.
    expect(clientAddressFrom("203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientAddressFrom("6.6.6.6, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientAddressFrom("6.6.6.6,7.7.7.7 , 203.0.113.9", 1)).toBe("203.0.113.9");
  });

  it("counts one more entry per proxy, and uses the first when the chain is shorter", () => {
    // CDN -> Traefik: the CDN records the client, Traefik records the CDN edge.
    expect(clientAddressFrom("6.6.6.6, 203.0.113.9, 198.51.100.7", 2)).toBe("203.0.113.9");
    expect(clientAddressFrom("203.0.113.9", 2)).toBe("203.0.113.9");
  });

  it("normalizes IPv6 and IPv4-mapped addresses, and rejects anything that isn't an address", () => {
    expect(clientAddressFrom("2001:DB8::1", 1)).toBe("2001:db8::1");
    expect(clientAddressFrom("::ffff:203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientAddressFrom("fe80::1%eth0", 1)).toBe("fe80::1");
    for (const value of [null, "", " , ", "unknown", "203.0.113.9:4711", "<script>", "203.0.113.9, nonsense"]) {
      expect(clientAddressFrom(value, 1)).toBeNull();
    }
  });
});

describe("rateLimitSubject", () => {
  it("keys IPv4 by address and IPv6 by /64 network", () => {
    expect(rateLimitSubject("203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitSubject("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:0db8:0001:0002::/64");
    expect(rateLimitSubject("2001:db8:1:2::ffff")).toBe("2001:0db8:0001:0002::/64");
    expect(rateLimitSubject("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
    expect(rateLimitSubject("::1")).toBe("0000:0000:0000:0000::/64");
    expect(rateLimitSubject("64:ff9b::192.0.2.1")).toBe("0064:ff9b:0000:0000::/64");
    expect(rateLimitSubject(null)).toBe("unknown");
  });
});
