import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EventArt OS",
  description: "Premium event planning, rentals, payments and guest management powered by Airtable.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
