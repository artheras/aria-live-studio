import http from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

/**
 * Configure global fetch() proxy support from HTTP_PROXY / HTTPS_PROXY / NO_PROXY.
 * No-op when no proxy environment variable is set.
 */
export function configureEnvProxy(): void {
  if (!hasEnvProxy()) return;
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

/**
 * Return an https.Agent that tunnels `wss://` connections through HTTPS_PROXY/HTTP_PROXY
 * when configured, or undefined for direct/local connections.
 */
export function getWebSocketProxyAgent(targetUrl: string): https.Agent | undefined {
  const proxyRaw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxyRaw) return undefined;

  let target: URL;
  let proxy: URL;
  try {
    target = new URL(targetUrl);
    proxy = new URL(proxyRaw);
  } catch {
    return undefined;
  }

  if (target.protocol !== "wss:" || isLocalOrBypassed(target.hostname)) {
    return undefined;
  }

  return new HttpConnectAgent(proxy);
}

function hasEnvProxy(): boolean {
  return Boolean(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy,
  );
}

function isLocalOrBypassed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    return true;
  }
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return noProxy.some((entry) => entry === "*" || host === entry || (entry.startsWith(".") && host.endsWith(entry)) || host.endsWith(`.${entry}`));
}

class HttpConnectAgent extends https.Agent {
  private readonly proxyUrl: URL;

  constructor(proxyUrl: URL) {
    super({ keepAlive: false });
    this.proxyUrl = proxyUrl;
  }

  override createConnection(
    options: https.RequestOptions,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    const targetHost = options.host || (options as { hostname?: string }).hostname;
    const targetPort = Number(options.port || 443);
    if (!targetHost) {
      callback?.(new Error("Missing target host for CONNECT proxy"), null as unknown as Duplex);
      return undefined;
    }

    const headers: Record<string, string> = {
      Host: `${targetHost}:${targetPort}`,
    };
    if (this.proxyUrl.username || this.proxyUrl.password) {
      const auth = `${decodeURIComponent(this.proxyUrl.username)}:${decodeURIComponent(this.proxyUrl.password)}`;
      headers["Proxy-Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;
    }

    const req = http.request({
      host: this.proxyUrl.hostname,
      port: Number(this.proxyUrl.port || (this.proxyUrl.protocol === "https:" ? 443 : 80)),
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      headers,
    });

    req.once("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        callback?.(new Error(`Proxy CONNECT failed with status ${res.statusCode}`), null as unknown as Duplex);
        return;
      }
      const tlsSocket = tls.connect({
        socket,
        servername: targetHost,
      });
      callback?.(null, tlsSocket);
    });

    req.once("error", (err) => {
      callback?.(err, null as unknown as Duplex);
    });
    req.end();
    return undefined;
  }
}
