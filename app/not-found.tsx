import Link from "next/link";

export default function NotFound() {
  return <main className="brand-page"><img src="/eventart-logo-transparent.png" alt="EventArt"/><h1>This page couldn&apos;t be found.</h1><Link href="/">Go back to Dashboard</Link></main>;
}
