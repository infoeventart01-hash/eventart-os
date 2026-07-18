type DevelopmentBypassInput = {
  hostname: string;
  nodeEnv: string | undefined;
  flag: string | undefined;
  configuredOwnerEmail: string;
  ownerEmail: string;
};

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function developmentAuthBypassEnabled(input: DevelopmentBypassInput) {
  const configuredOwner = input.configuredOwnerEmail.trim().toLowerCase();
  const expectedOwner = input.ownerEmail.trim().toLowerCase();
  return localHosts.has(input.hostname.toLowerCase())
    && input.nodeEnv !== "production"
    && input.flag?.trim().toLowerCase() === "true"
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredOwner)
    && configuredOwner === expectedOwner;
}
