import type { Metadata } from "next";
import "./globals.css";
import "./dashboard.css";
import "./payments.css";
import "./payment-modal.css";

export const metadata: Metadata = {
  title: "EventArt",
  description: "EventArt — Luxury Event Design & Styling.",
  applicationName: "EventArt",
  icons: { icon: "/eventart-logo-transparent.png", shortcut: "/eventart-logo-transparent.png", apple: "/eventart-logo-transparent.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
