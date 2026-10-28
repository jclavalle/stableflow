import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { TestnetBanner } from "@/components/TestnetBanner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StableFlow — testnet demo",
  description:
    "Prototype of a stablecoin payment flow for LATAM freelancers. Base Sepolia testnet only; fiat payout is simulated.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TestnetBanner />
        {children}
      </body>
    </html>
  );
}
