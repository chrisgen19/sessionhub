import { Globe } from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";

/**
 * Favicon from Chrome's local cache via the `_favicon` endpoint (needs the `favicon`
 * permission). No third-party icon URL is ever fetched.
 */
const faviconSrc = (pageUrl: string) =>
  `chrome-extension://${browser.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;

export function TabFavicon({ url, restorable }: { url: string; restorable: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!restorable || failed) {
    return <Globe aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />;
  }
  return (
    <img
      src={faviconSrc(url)}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      className="size-4 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}
