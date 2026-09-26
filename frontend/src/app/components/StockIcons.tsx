import React from "react";

interface StockIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export default function StockIcon({ symbol, size = 38, className = "" }: StockIconProps) {
  const s = symbol.toUpperCase();

  switch (s) {
    case "AAPL":
      return (
        <div
          className={className}
          style={{
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.28),
            background: "#09090b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }}
          title="Apple Inc."
        >
          <svg
            width={Math.round(size * 0.52)}
            height={Math.round(size * 0.52)}
            viewBox="0 0 170 170"
            fill="currentColor"
          >
            <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.58-7.74-11.64-14.1-6.19-9.67-11.03-20.91-14.51-33.72-3.48-12.81-5.22-24.96-5.22-36.46 0-14.67 3.86-27.18 11.58-37.52 7.73-10.34 17.67-15.65 29.83-15.93 4.8 0 10.15 1.25 16.06 3.76 5.91 2.51 9.87 3.82 11.89 3.93 1.62-.11 5.76-1.5 12.42-4.17 6.66-2.67 12.3-3.83 16.92-3.48 13.04.87 23.37 5.75 31 14.64-11.4 6.85-17.01 16.48-16.82 28.89.2 9.68 3.86 17.84 10.99 24.47 7.12 6.64 15.66 10.39 25.62 11.25-2.07 6.31-4.7 13.05-7.89 20.21zm-32.33-118.8c0 7.37-2.73 14.42-8.18 21.14-5.45 6.72-12.28 10.74-20.49 12.06-.22-1.3-.33-2.61-.33-3.92 0-7.39 3-14.93 9-22.61 6.01-7.69 13.06-12.07 21.14-13.15.11 2.17.17 3.51.17 4.02z" />
          </svg>
        </div>
      );

    case "MSFT":
      return (
        <div
          className={className}
          style={{
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.28),
            background: "#ffffff",
            border: "1px solid #e4e4e7",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
          }}
          title="Microsoft Corporation"
        >
          <svg
            width={Math.round(size * 0.54)}
            height={Math.round(size * 0.54)}
            viewBox="0 0 24 24"
          >
            <rect x="2" y="2" width="9.2" height="9.2" rx="1.2" fill="#f25022" />
            <rect x="12.8" y="2" width="9.2" height="9.2" rx="1.2" fill="#7fba00" />
            <rect x="2" y="12.8" width="9.2" height="9.2" rx="1.2" fill="#00a4ef" />
            <rect x="12.8" y="12.8" width="9.2" height="9.2" rx="1.2" fill="#ffb900" />
          </svg>
        </div>
      );

    case "NVDA":
      return (
        <div
          className={className}
          style={{
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.28),
            background: "#76b900",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            flexShrink: 0,
            boxShadow: "0 2px 8px rgba(118, 185, 0, 0.3)",
          }}
          title="NVIDIA Corporation"
        >
          <svg
            width={Math.round(size * 0.6)}
            height={Math.round(size * 0.6)}
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M7.74 16.14c-1.32-.42-2.14-1.28-2.58-2.67-.34-1.07-.31-2.63.09-3.79.62-1.8 2.05-3.05 3.86-3.37 1.05-.18 2.21-.08 3.19.28.32.12.35.21.17.43-.16.19-.34.39-.5.59-.1.12-.2.12-.34.07-.94-.34-1.92-.37-2.88-.1-1.36.38-2.3 1.25-2.63 2.6-.33 1.34-.03 2.76.84 3.79.82.97 1.88 1.41 3.14 1.31 1.01-.08 1.88-.51 2.59-1.22.42-.42.74-.93.99-1.49.09-.2.03-.31-.17-.32-.97-.05-1.94-.05-2.91-.05-.28 0-.37-.08-.37-.36 0-.39 0-.79 0-1.18 0-.27.09-.36.36-.36 1.48 0 2.96 0 4.44 0 .28 0 .37.08.37.36 0 .52-.04 1.03-.13 1.54-.25 1.44-.89 2.68-1.93 3.69-1.12 1.09-2.47 1.74-4.04 1.93-.52.06-1.04.05-1.54-.06z"
              fill="#ffffff"
            />
            <path
              d="M19.46 9.87c.39 1.15.54 2.34.46 3.55-.13 2.03-.89 3.82-2.28 5.29-1.6 1.69-3.57 2.67-5.87 2.91-.97.1-1.94.04-2.89-.17-1.74-.39-3.23-1.26-4.44-2.58-.2-.22-.19-.32.05-.51.18-.15.36-.3.55-.44.17-.13.29-.11.45.07 1.1 1.2 2.45 1.97 4.02 2.32 1.87.42 3.69.17 5.37-.73 1.73-.93 2.94-2.34 3.61-4.16.59-1.59.67-3.23.23-4.88-.34-1.27-.99-2.36-1.91-3.27-.2-.2-.17-.31.05-.51.18-.16.37-.33.56-.49.19-.16.31-.14.5.06 1.09 1.14 1.82 2.49 2.13 3.99z"
              fill="#ffffff"
            />
          </svg>
        </div>
      );

    case "TSLA":
      return (
        <div
          className={className}
          style={{
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.28),
            background: "#18181b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }}
          title="Tesla, Inc."
        >
          <svg
            width={Math.round(size * 0.54)}
            height={Math.round(size * 0.54)}
            viewBox="0 0 24 24"
            fill="#e82127"
          >
            <path d="M12 4.2c2.8 0 5.4.6 7.6 1.7.3-1.1.8-1.8 1.4-2.4C18 2.2 14.8 1.6 12 1.6S6 2.2 3 3.5c.6.6 1.1 1.3 1.4 2.4 2.2-1.1 4.8-1.7 7.6-1.7z" />
            <path d="M12 5.6c-2.4 0-4.6.4-6.6 1.2-.2.8-.2 1.5-.1 2.2 1.9-.7 4.1-1.1 6.7-1.1s4.8.4 6.7 1.1c.1-.7.1-1.4-.1-2.2-2-.8-4.2-1.2-6.6-1.2z" />
            <path d="M10.8 9.3v13.1h2.4V9.3c1.4.1 2.8.4 4.1.8.5-1.5.8-2.6.9-3.2-1.5-.4-3.2-.6-5-.6s-3.5.2-5 .6c.1.6.4 1.7.9 3.2 1.3-.4 2.7-.7 4.1-.8h-.2z" />
          </svg>
        </div>
      );

    case "GOOGL":
      return (
        <div
          className={className}
          style={{
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.28),
            background: "#ffffff",
            border: "1px solid #e4e4e7",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
          }}
          title="Alphabet Inc. (Google)"
        >
          <svg
            width={Math.round(size * 0.52)}
            height={Math.round(size * 0.52)}
            viewBox="0 0 24 24"
          >
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
        </div>
      );

    default:
      return (
        <div
          className={className}
          style={{
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.28),
            background: "#f4f4f5",
            border: "1px solid #e4e4e7",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.round(size * 0.32),
            fontWeight: 700,
            color: "#18181b",
            flexShrink: 0,
          }}
        >
          {s.slice(0, 3)}
        </div>
      );
  }
}
