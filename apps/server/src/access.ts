import { BlockList, isIP } from "node:net";

/**
 * Who is looking. Self-hosted, so there is no login: a person on this machine
 * (or a network the owner trusts) is the owner; anyone else only watches.
 */
export type Viewer = "owner" | "public";

export interface AccessOptions {
  /** CIDRs whose requests count as the owner, e.g. "100.64.0.0/10". */
  trustedNetworks: string[];
  /** Host names the server answers to besides loopback (DNS rebinding guard). */
  allowedHosts: string[];
  /** Host names that are always public, e.g. a tunnel or reverse proxy domain. */
  publicHosts: string[];
}

export interface RequestFacts {
  remoteAddress: string | undefined;
  host: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function accessOptionsFromEnv(env: NodeJS.ProcessEnv): AccessOptions {
  return {
    trustedNetworks: parseList(env.OFFICE_TRUSTED_NETWORKS),
    allowedHosts: parseList(env.OFFICE_ALLOWED_HOSTS),
    publicHosts: parseList(env.OFFICE_PUBLIC_HOSTS),
  };
}

/** "host:port", "[::1]:port" or "host" → bare lowercase host name. */
export function hostName(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(1, value.indexOf("]"));
  const colon = value.lastIndexOf(":");
  return colon > 0 && value.indexOf(":") === colon
    ? value.slice(0, colon)
    : value;
}

function unmapped(address: string): string {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function createAccess(options: AccessOptions) {
  const trusted = new BlockList();
  for (const cidr of options.trustedNetworks) {
    const [network, prefix] = cidr.split("/");
    const family = isIP(network) === 6 ? "ipv6" : "ipv4";
    if (!isIP(network)) continue;
    trusted.addSubnet(
      network,
      Number(prefix ?? (family === "ipv6" ? 128 : 32)),
      family,
    );
  }
  const allowed = new Set([
    ...loopbackHosts,
    ...options.allowedHosts,
    ...options.publicHosts,
  ]);
  const publicHosts = new Set(options.publicHosts);

  function isLoopback(address: string): boolean {
    return address === "::1" || address.startsWith("127.");
  }

  return {
    /** False when the Host header is unknown: refuse the request outright. */
    hostAllowed(facts: RequestFacts): boolean {
      // No socket means an in-process request (tests), not a browser.
      if (facts.remoteAddress === undefined && !facts.host) return true;
      const name = hostName(facts.host);
      return name !== undefined && allowed.has(name);
    },

    viewer(facts: RequestFacts): Viewer {
      if (facts.remoteAddress === undefined && !facts.host) return "owner";
      const name = hostName(facts.host);
      if (name && publicHosts.has(name)) return "public";
      // A proxy or tunnel forwards outside visitors from loopback; never
      // mistake them for the owner.
      if (facts.headers["x-forwarded-for"] || facts.headers.forwarded)
        return "public";
      const address = unmapped(facts.remoteAddress ?? "");
      if (!isIP(address)) return "public";
      if (isLoopback(address)) return "owner";
      const family = isIP(address) === 6 ? "ipv6" : "ipv4";
      return trusted.check(address, family) ? "owner" : "public";
    },

    /** A browser on another site must not drive the owner's agents. */
    sameOrigin(facts: RequestFacts): boolean {
      const origin = facts.headers.origin;
      if (typeof origin !== "string") return true;
      try {
        return new URL(origin).host === facts.host;
      } catch {
        return false;
      }
    },
  };
}

export type Access = ReturnType<typeof createAccess>;
