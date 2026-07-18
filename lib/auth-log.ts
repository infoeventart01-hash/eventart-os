type SafeAuthDetail = Record<string, string | number | boolean | null | undefined>;

const forbiddenDetailName = /(password|token|secret|authorization|credential|email|key|value)/i;

export function logAuthStep(step: string, details: SafeAuthDetail = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([name, value]) =>
      !forbiddenDetailName.test(name) && ["string", "number", "boolean"].includes(typeof value),
    ),
  );
  console.info("EventArt authentication", { step, ...safeDetails });
}

export function safeAuthError(error: unknown) {
  if (!error || typeof error !== "object") return { errorType: "unknown" };
  const candidate = error as { name?: unknown; code?: unknown; status?: unknown; message?: unknown };
  return {
    errorType: typeof candidate.name === "string" ? candidate.name : "unknown",
    errorCode: typeof candidate.code === "string" ? candidate.code : "unknown",
    errorStatus: typeof candidate.status === "number" ? candidate.status : 0,
    errorMessage: typeof candidate.message === "string" ? candidate.message : "Authentication request failed.",
  };
}
