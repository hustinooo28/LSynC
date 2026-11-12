import { useEffect, useRef, useState } from "react";
import { ExternalLink, Facebook, Megaphone } from "lucide-react";
import Reveal from "@/components/motion/Reveal";

export const FACEBOOK_PAGE_URL = "https://www.facebook.com/dsscsclsc";

/**
 * Latest posts from the council's Facebook page via Facebook's official Page
 * Plugin (no API token needed; it always shows the newest posts). The plugin
 * renders at a fixed pixel width between 180 and 500, so we measure the slot
 * and rebuild the iframe URL when its width changes meaningfully.
 */
export default function FacebookFeed() {
  const slotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const height = width < 400 ? 560 : 640;

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const observer = new ResizeObserver(([entry]) => {
      // Round to 20px steps so small layout shifts don't reload the iframe.
      const next = Math.min(500, Math.max(180, Math.floor(entry.contentRect.width / 20) * 20));
      setWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  const src =
    "https://www.facebook.com/plugins/page.php?" +
    new URLSearchParams({
      href: FACEBOOK_PAGE_URL,
      tabs: "timeline",
      width: String(width),
      height: String(height),
      small_header: "true",
      adapt_container_width: "true",
      hide_cover: "false",
      show_facepile: "false",
    });

  return (
    <section className="bg-page px-4 pb-20 sm:px-6 lg:pb-28">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_auto] lg:gap-16">
        <Reveal stagger className="text-center lg:text-left">
          <span className="eyebrow">
            <Megaphone className="h-3.5 w-3.5" /> Council updates
          </span>
          <h2 className="mt-4 text-3xl font-extrabold sm:text-5xl">Latest from our Facebook page</h2>
          <p className="mx-auto mt-4 max-w-md text-muted lg:mx-0">
            Announcements, event reminders and updates — straight from the council&apos;s official page, the moment
            they&apos;re posted.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <a href={FACEBOOK_PAGE_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">
              <Facebook className="h-4 w-4" /> Follow the council
              <span className="btn-orb">
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </a>
          </div>
        </Reveal>

        <Reveal className="mx-auto w-full max-w-[500px] lg:w-[500px]">
          <div className="card overflow-hidden p-2 shadow-lift">
            <div ref={slotRef} className="relative overflow-hidden rounded-2xl bg-surface-2" style={{ height }}>
              {/* Sits behind the iframe: visible only if Facebook refuses to render (e.g. blocked by the browser). */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="icon-tile h-14 w-14">
                  <Facebook className="h-6 w-6" />
                </span>
                <p className="font-semibold text-ink">Posts load from Facebook</p>
                <p className="max-w-xs text-sm text-muted">
                  If nothing appears, your browser may be blocking Facebook content. You can still see every update on our page.
                </p>
                <a href={FACEBOOK_PAGE_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                  Open on Facebook <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              {!loaded && (
                <div className="absolute inset-0 z-20 space-y-4 bg-surface-2 p-5" aria-hidden>
                  <div className="flex items-center gap-3">
                    <div className="skeleton h-12 w-12 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-3.5 w-40" />
                      <div className="skeleton h-3 w-24" />
                    </div>
                  </div>
                  <div className="skeleton h-48 w-full rounded-2xl" />
                  <div className="skeleton h-3 w-11/12" />
                  <div className="skeleton h-3 w-3/4" />
                </div>
              )}
              {width > 0 && (
                <iframe
                  key={width}
                  title="Latest posts from the council's Facebook page"
                  src={src}
                  width={width}
                  height={height}
                  loading="lazy"
                  onLoad={() => setLoaded(true)}
                  className={`relative z-10 mx-auto block border-0 transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
                  allow="encrypted-media; clipboard-write; web-share"
                />
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
