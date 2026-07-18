"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [reason, setReason] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    setReason(new URLSearchParams(window.location.search).get("error") || "");
    fetch("/api/auth/config", { cache: "no-store" })
      .then(response => response.json())
      .then(data => setConfigured(data.configured === true
        && data.supabaseUrlValid === true
        && data.supabaseUrlPresent === true
        && data.publishableKeyPresent === true
        && data.serviceKeyPresent === true
        && data.ownerEmailPresent === true
        && data.appUrlPresent === true))
      .catch(() => setConfigured(null));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || configured === false) return; setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to sign in.");
      const confirmation = await fetch("/api/auth/me", { cache: "no-store" });
      if (!confirmation.ok) {
        const details = await confirmation.json().catch(() => ({})) as { error?: string };
        throw new Error(details.error || "Sign-in succeeded, but EventArt could not confirm the server session.");
      }
      const next = new URLSearchParams(window.location.search).get("returnTo");
      window.location.assign(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in."); setBusy(false);
    }
  }
  return <main className="auth-page"><section className="auth-card"><img src="/eventart-logo-transparent.png" alt="EventArt"/><p className="eyebrow">Luxury Event Design &amp; Styling</p><h1>Welcome to EventArt</h1><p>Sign in to manage your events, clients, budgets and proposals.</p>{(configured === false) && <div className="auth-error">Authentication configuration needs attention before EventArt can complete sign-in.</div>}{reason === "inactive" && <div className="auth-error">This account is inactive. Contact the EventArt owner.</div>}{reason === "invalid-link" && <div className="auth-error">This sign-in or password-reset link is invalid or has expired.</div>}{reason === "session-reset" && <div className="auth-error">An outdated sign-in session was cleared. Please sign in again.</div>}{error && <div className="auth-error">{error}</div>}<form onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="email" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label><label className="remember"><input type="checkbox" defaultChecked/> Remember me</label><button className="gold-button" disabled={busy || configured !== true}>{busy ? "Signing in..." : "Sign In"}</button></form><Link href="/forgot-password">Forgot Password?</Link></section></main>;
}
