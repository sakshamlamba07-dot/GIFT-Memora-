import { useMemo } from "react";
import { LandingPageFrame } from "./LandingPageFrame";
import "./memora-frame.css";

export type MemoraLandingPageProps = {
  headingFont?: "onest" | "instrument-serif" | "newsreader" | "geist";
  bodyFont?: "onest" | "geist" | "newsreader" | "instrument-serif";
  headingWeight?: "400" | "500" | "600" | "700";
  bodyWeight?: "300" | "400" | "500" | "600";
  primaryColor?: string;
  headingSize?: number;          // 30–72
  bodySize?: number;
  headingLetterSpacing?: number; // em
};

const FONTS: Record<string, string> = {
  onest: "'Onest',system-ui,-apple-system,'Helvetica Neue',sans-serif",
  geist: "'Geist',system-ui,sans-serif",
  newsreader: "'Newsreader',Georgia,serif",
  "instrument-serif": "'Instrument Serif',Georgia,serif"
};

export function MemoraLandingPage({
  headingFont = "onest",
  bodyFont = "onest",
  headingWeight = "400",
  bodyWeight = "300",
  primaryColor = "#c9956a",
  headingSize = 46,
  bodySize = 17,
  headingLetterSpacing = -0.012
}: MemoraLandingPageProps) {
  /* the props travel with the document rather than being re-applied from the
     host, so the page renders correctly when opened directly too */
  const src = useMemo(() => {
    const q = new URLSearchParams({
      headFont: FONTS[headingFont] ?? FONTS.onest,
      bodyFont: FONTS[bodyFont] ?? FONTS.onest,
      headWeight: headingWeight,
      bodyWeight: bodyWeight,
      primary: primaryColor,
      headSize: String(Math.min(72, Math.max(30, headingSize))),
      bodySizePx: String(bodySize),
      headTrack: String(headingLetterSpacing)
    });
    return `/gifte-memora/index.html?${q.toString()}`;
  }, [headingFont, bodyFont, headingWeight, bodyWeight, primaryColor,
      headingSize, bodySize, headingLetterSpacing]);

  return (
    <div className="memora-landing-page">
      <LandingPageFrame
        title="The Giftè Memora"
        sourceUrl={src}
        className="memora-landing-page__frame"
      />
    </div>
  );
}

/* configured usage */
export function Scene() {
  return (
    <MemoraLandingPage
      headingFont="onest"
      bodyFont="onest"
      primaryColor="#c9956a"
    />
  );
}
