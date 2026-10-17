import { Globe } from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";

/**
 * Favicon from Chrome's local cache via the `_favicon` endpoint (needs the `favicon`
 * permission). No third-party icon URL is ever fetched.
 */
const faviconSrc = (pageUrl: string) =>
  `chrome-extension://${browser.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;

/** `small` (12px) is for previews that fit several icons in one tile. */
export function TabFavicon({ url, restorable, small = false }: { url: string; restorable: boolean; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = small ? "size-3" : "size-4";
  if (!restorable || failed) {
    return <Globe aria-hidden="true" className={`${size} shrink-0 text-fg-muted`} />;
  }
  return (
    <img
      src={faviconSrc(url)}
      alt=""
      width={small ? 12 : 16}
      height={small ? 12 : 16}
      loading="lazy"
      className={`${size} shrink-0 rounded-sm`}
      onError={() => setFailed(true)}
    />
  );
}
