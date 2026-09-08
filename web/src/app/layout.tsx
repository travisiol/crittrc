import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { site } from "@/lib/site";

// Jersey 15 (OFL) ships in the repo: the build never reaches out to Google
// and neither does the browser. `--font-pixel` is what the stylesheet keys off.
const jersey = localFont({
  src: "./fonts/Jersey15-Regular.ttf",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-pixel",
});

const title = `${site.name} — ${site.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title,
  description: site.description,
  keywords: [...site.keywords],
  openGraph: {
    title,
    description: site.description,
    url: site.url,
    siteName: site.name,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: site.description,
  },
};

export const viewport: Viewport = {
  themeColor: "#2f5f3a",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jersey.variable} h-full`}>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
