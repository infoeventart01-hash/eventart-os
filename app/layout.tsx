import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EventArt | Luxury Event Design & Styling",
  description: "EventArt — Luxury Event Design & Styling.",
  applicationName: "EventArt",
  icons: { icon: "/eventart-logo.jpeg", shortcut: "/eventart-logo.jpeg", apple: "/eventart-logo.jpeg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
