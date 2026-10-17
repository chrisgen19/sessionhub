import { isIPv4, isIPv6 } from "node:net";
import { getServerEnv } from "./env";

/**
 * Client addresses behind reverse proxies (docs/DEPLOYMENT.md, "Proxy and client IP").
 *
 * Each proxy appends the address it received the request from to X-Forwarded-For, so only the
 * last TRUSTED_PROXY_COUNT entries were written by infrastructure we run. Anything to their left
 * came from the client and is ignored: taking the leftmost entry would let anyone pick their own
 * rate-limit bucket. Coolify's Traefik is one proxy (the default); a CDN in front adds one more.
 */

/** Unwraps IPv4-mapped IPv6 (`::ffff:192.0.2.1`) and drops zone ids; null when not an IP address. */
const normalizeAddress = (value: string): string | null => {
  const address = value.split("%")[0] ?? "";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (mapped && isIPv4(mapped)) return mapped;
  if (isIPv4(address)) return address;
  return isIPv6(address) ? address.toLowerCase() : null;
};

/**
 * The address the outermost trusted proxy received the request from: the entry `proxies` places
 * from the right. A shorter chain passed through fewer proxies, so its first entry is the one
 * recorded closest to the client. Null when the header is absent or that entry isn't an address.
 */
export const clientAddressFrom = (forwardedFor: string | null, proxies: number): string | null => {
  const chain = (forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const entry = chain[Math.max(0, chain.length - proxies)];
  return entry ? normalizeAddress(entry) : null;
};

/** The client address for a request, as the configured proxies recorded it. */
export const clientAddress = (headers: Headers): string | null => clientAddressFrom(headers.get("x-forwarded-for"), getServerEnv().TRUSTED_PROXY_COUNT);

/** The eight 16-bit groups of an IPv6 address (an embedded IPv4 tail counts as two). */
const ipv6Groups = (address: string): string[] => {
  const groups = (text: string) => (text ? text.split(":") : []).flatMap((part) => (part.includes(".") ? ["0", "0"] : [part]));
  const [head = "", tail] = address.split("::");
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const gap = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(gap).fill("0"), ...right].map((group) => group.padStart(4, "0"));
};

/**
 * Who a per-IP rate limit counts: the address itself for IPv4, the /64 prefix for IPv6 (one
 * customer network can hold billions of addresses), like Better Auth's own limiter. Requests with
 * no usable address share one `unknown` bucket: stricter, never a way around the limit.
 */
export const rateLimitSubject = (address: string | null): string => {
  if (!address) return "unknown";
  return address.includes(":") ? `${ipv6Groups(address).slice(0, 4).join(":")}::/64` : address;
};
