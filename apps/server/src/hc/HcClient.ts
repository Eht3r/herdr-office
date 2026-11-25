import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface HcTerminal {
  address: string;
  agent?: string | null;
  cwd: string;
  foreground?: { name?: string; argv?: string[] } | null;
  labels: Record<string, string>;
  name?: string | null;
  parent?: string | null;
  state: string;
  status?: { app?: string; state: string; title?: string } | null;
  title?: string;
  turn?: number;
}

export interface HcMachine {
  name: string;
  host?: string;
  temporary?: boolean;
}

export interface TerminalList {
  machines: HcMachine[];
  terminals: HcTerminal[];
}

export interface HcFact {
  seq: number;
  type: string;
  terminal: string | null;
  data: unknown;
}

interface SubscriptionSnapshot {
  terminals: HcTerminal[];
  seq: number;
}

interface WatchHandlers {
  snapshot: (snapshot: SubscriptionSnapshot) => void;
  event: (fact: HcFact) => void;
  missed: () => void;
  disconnected: () => void;
  heartbeat?: () => void;
}

interface RpcResponse {
  result?: unknown;
  error?: { message: string };
  method?: string;
  params?: unknown;
}

type ReadMethod = "terminal.list" | "terminal.read" | "doc.get";

export class HcClient {
  private readonly closes = new Set<() => void>();

  constructor(
    private readonly command = "hc",
    private readonly args = ["connect"],
  ) {}

  private connect(): ChildProcessWithoutNullStreams {
    const child = spawn(this.command, this.args, { stdio: "pipe" });
    child.stdin.on("error", () => child.kill());
    child.stderr.resume();
    return child;
  }

  private send(
    child: ChildProcessWithoutNullStreams,
    method: ReadMethod | "events.subscribe",
    params: object,
  ): void {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`,
    );
  }

  request<T>(method: ReadMethod, params: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const child = this.connect();
      const stream = createInterface({ input: child.stdout });
      let settled = false;
      const close = () => finish(new Error(`HC ${method} was closed`));
      const timer = setTimeout(
        () => finish(new Error(`HC ${method} timed out`)),
        8_000,
      );
      const finish = (error?: Error, result?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.closes.delete(close);
        stream.close();
        child.kill();
        if (error) reject(error);
        else resolve(result as T);
      };
      this.closes.add(close);
      stream.once("line", (line) => {
        try {
          const response = JSON.parse(line) as RpcResponse;
          if (response.result === undefined) {
            finish(
              new Error(
                response.error?.message ?? `Invalid HC ${method} response`,
              ),
            );
          } else {
            finish(undefined, response.result);
          }
        } catch (error) {
          finish(new Error(`Invalid HC ${method} JSON`, { cause: error }));
        }
      });
      child.once("error", finish);
      child.once("close", () => finish(new Error(`HC ${method} exited`)));
      this.send(child, method, params);
    });
  }

  watch(params: { docs?: string[] }, handlers: WatchHandlers): void {
    let stopped = false;
    let retry = 250;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopChild: (() => void) | undefined;

    const start = () => {
      const child = this.connect();
      const stream = createInterface({ input: child.stdout });
      let active = true;
      let seq = -1;
      let awaitingSnapshot = true;
      let expiry = setTimeout(() => end(), 8_000);
      const shutdown = () => {
        active = false;
        clearTimeout(expiry);
        stream.close();
        child.kill();
      };
      const end = () => {
        if (!active) return;
        shutdown();
        handlers.disconnected();
        if (stopped) return;
        timer = setTimeout(start, retry);
        retry = Math.min(retry * 2, 10_000);
      };
      stopChild = shutdown;
      stream.on("line", (line) => {
        if (!active) return;
        let response: RpcResponse;
        try {
          response = JSON.parse(line) as RpcResponse;
        } catch {
          end();
          return;
        }
        if (response.error) {
          end();
          return;
        }
        clearTimeout(expiry);
        expiry = setTimeout(end, 35_000);
        if (response.result || response.method === "snapshot") {
          const snapshot = (response.result ?? response.params) as
            | SubscriptionSnapshot
            | undefined;
          if (
            !snapshot ||
            typeof snapshot.seq !== "number" ||
            !Array.isArray(snapshot.terminals)
          ) {
            end();
            return;
          }
          retry = 250;
          seq = snapshot.seq;
          awaitingSnapshot = false;
          handlers.snapshot(snapshot);
        } else if (response.method === "missed") {
          awaitingSnapshot = true;
          handlers.missed();
        } else if (response.method === "heartbeat") {
          handlers.heartbeat?.();
        } else if (response.method === "event" && !awaitingSnapshot) {
          const fact = response.params as HcFact;
          if (fact?.seq > seq) {
            seq = fact.seq;
            handlers.event(fact);
          }
        }
      });
      child.once("error", end);
      child.once("close", end);
      this.send(child, "events.subscribe", params);
    };

    this.closes.add(() => {
      stopped = true;
      clearTimeout(timer);
      stopChild?.();
    });
    start();
  }

  close(): void {
    for (const close of this.closes) close();
    this.closes.clear();
  }
}
