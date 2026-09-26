import React, { useState } from "react";

interface StockIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

// Map ticker → company domain for Clearbit Logo API
const DOMAIN_MAP: Record<string, string> = {
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  NVDA: "nvidia.com",
  TSLA: "tesla.com",
  GOOGL: "google.com",
  GOOG: "google.com",
  AMZN: "amazon.com",
  META: "meta.com",
  NFLX: "netflix.com",
  AMD: "amd.com",
  INTC: "intel.com",
  ORCL: "oracle.com",
  ADBE: "adobe.com",
  CRM: "salesforce.com",
  SHOP: "shopify.com",
  UBER: "uber.com",
  LYFT: "lyft.com",
  SNAP: "snap.com",
  TWTR: "twitter.com",
  COIN: "coinbase.com",
  SQ: "squareup.com",
  PYPL: "paypal.com",
  V: "visa.com",
  MA: "mastercard.com",
  JPM: "jpmorganchase.com",
  GS: "goldmansachs.com",
  BAC: "bankofamerica.com",
  WMT: "walmart.com",
  DIS: "disney.com",
  SBUX: "starbucks.com",
  MCD: "mcdonalds.com",
  NKE: "nike.com",
  PFE: "pfizer.com",
  JNJ: "jnj.com",
  MRNA: "modernatx.com",
  BABA: "alibaba.com",
  TSM: "tsmc.com",
  SPOT: "spotify.com",
  ABNB: "airbnb.com",
  HOOD: "robinhood.com",
};

// Fallback colors per ticker for the placeholder
const FALLBACK_COLORS: Record<string, string> = {
  AAPL: "#09090b",
  MSFT: "#00a4ef",
  NVDA: "#76b900",
  TSLA: "#e82127",
  GOOGL: "#4285F4",
  GOOG: "#4285F4",
  AMZN: "#FF9900",
  META: "#0866FF",
  NFLX: "#E50914",
  AMD: "#ED1C24",
  INTC: "#0071C5",
  DEFAULT: "#6366f1",
};

function getFallbackColor(symbol: string): string {
  return FALLBACK_COLORS[symbol.toUpperCase()] ?? FALLBACK_COLORS.DEFAULT;
}

export default function StockIcon({ symbol, size = 38, className = "" }: StockIconProps) {
  const s = symbol.toUpperCase();
  const domain = DOMAIN_MAP[s];
  const radius = Math.round(size * 0.28);
  const imgSize = Math.round(size * 0.72);

  const [failed, setFailed] = useState(false);

  const containerStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    background: "#ffffff",
    border: "1px solid #e4e4e7",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)",
  };

  // If no domain mapping or image failed — render a clean letter avatar
  if (!domain || failed) {
    return (
      <div
        className={className}
        style={{
          ...containerStyle,
          background: getFallbackColor(s),
          border: "none",
          boxShadow: `0 2px 8px ${getFallbackColor(s)}44`,
        }}
        title={s}
        aria-label={s}
      >
        <span
          style={{
            color: "#ffffff",
            fontSize: Math.round(size * 0.33),
            fontWeight: 700,
            fontFamily: "'Inter', system-ui, sans-serif",
            letterSpacing: "-0.03em",
            lineHeight: 1,
          }}
        >
          {s.slice(0, 2)}
        </span>
      </div>
    );
  }

  // Use Clearbit Logo API — real, high-quality corporate logos
  const src = `https://logo.clearbit.com/${domain}?size=${imgSize * 2}`;

  return (
    <div
      className={className}
      style={containerStyle}
      title={s}
      aria-label={s}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={s}
        width={imgSize}
        height={imgSize}
        style={{
          objectFit: "contain",
          borderRadius: radius - 2,
        }}
        onError={() => setFailed(true)}
        loading="lazy"
      />
    </div>
  );
}
