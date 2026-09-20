import { useEffect, useRef, useState } from "react";

export type LandingPageFrameProps = {
  title: string;
  sourceUrl: string;
  className?: string;
  style?: React.CSSProperties;
};

/** Hosts the complete authored document in a full-size iframe whose
 *  permissions retain its forms, modals, popups, scripts and same-origin
 *  resources — the document owns its own lifecycle, so it is never imported
 *  into the application JavaScript graph. */
export function LandingPageFrame({ title, sourceUrl, className, style }: LandingPageFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onLoad = () => setReady(true);
    el.addEventListener("load", onLoad);
    return () => el.removeEventListener("load", onLoad);
  }, []);

  return (
    <iframe
      ref={ref}
      title={title}
      src={sourceUrl}
      className={[className, ready ? "is-ready" : ""].filter(Boolean).join(" ")}
      style={style}
      loading="lazy"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      allow="autoplay; fullscreen"
    />
  );
}
