import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { ClinicError } from "./consultations.js";
import { parseReading, type BandReading } from "./reading.js";

export interface NativeBandStatus {
  available: boolean;
  running: boolean;
  phase: string;
  message: string;
  readings: number;
  updatedAt: string;
  pollIntervalMs: number;
  lastReadingAt?: string;
  startedAt?: string;
  bridgeId?: string;
}

export class WindowsBandReader {
  private child?: ChildProcess;
  private state: NativeBandStatus;
  private completion?: Promise<void>;
  constructor(
    private readonly script: string,
    private readonly save: (
      reading: Omit<BandReading, "id" | "receivedAt">,
    ) => Promise<void>,
    private readonly notify: (status: NativeBandStatus) => void,
  ) {
    this.state = {
      available: process.platform === "win32" && existsSync(script),
      running: false,
      phase: "idle",
      message:
        "Start monitoring using the paired band. The server collects readings every 10 seconds.",
      readings: 0,
      pollIntervalMs: 10000,
      updatedAt: new Date().toISOString(),
    };
  }
  status() {
    return { ...this.state };
  }
  private update(change: Partial<NativeBandStatus>) {
    this.state = {
      ...this.state,
      ...change,
      updatedAt: new Date().toISOString(),
    };
    this.notify(this.status());
  }
  start() {
    if (!this.state.available)
      throw new ClinicError(
        "Direct monitoring requires this Windows computer and the local Bluetooth helper.",
        503,
      );
    if (this.state.running)
      throw new ClinicError("Band monitoring is already running.", 409);
    this.update({
      running: true,
      phase: "connecting",
      message: "Connecting to the band through Windows.",
      readings: 0,
      lastReadingAt: undefined,
      startedAt: new Date().toISOString(),
    });
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        this.script,
        "-Continuous",
        "-ControlStdin",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    let buffer = "";
    let writes = Promise.resolve();
    let failed = false;
    let finished = false;
    let lastOutput = Date.now();
    let forceStop: ReturnType<typeof setTimeout> | undefined;
    const stopChild = () => {
      if (forceStop) return;
      child.stdin?.end("stop\n");
      forceStop = setTimeout(() => child.kill(), 20000);
      forceStop.unref();
    };
    const fail = (message: string) => {
      failed = true;
      this.update({ phase: "error", message });
      stopChild();
    };
    const watchdog = setInterval(() => {
      if (Date.now() - lastOutput > 90000)
        fail(
          "The band stopped responding. Monitoring has been stopped; reconnect to resume.",
        );
    }, 5000);
    watchdog.unref();
    const line = (value: string) => {
      try {
        const event = JSON.parse(value);
        lastOutput = Date.now();
        if (event.event === "reading") {
          const reading = parseReading(event.reading);
          if (!reading || reading.source !== "band")
            throw new Error("Invalid band observation.");
          writes = writes
            .then(async () => {
              if (failed) return;
              await this.save(reading);
              this.update({
                readings: this.state.readings + 1,
                lastReadingAt: reading.observedAt,
              });
            })
            .catch(() =>
              fail(
                "A band observation could not be saved. Check the local data directory.",
              ),
            );
        } else if (
          event.event === "status" &&
          typeof event.message === "string"
        ) {
          if (event.phase === "error") fail(event.message.slice(0, 500));
          else if (!failed && this.state.phase !== "stopping")
            this.update({
              phase: String(event.phase).slice(0, 40),
              message: event.message.slice(0, 500),
            });
        }
      } catch {
        fail("The Bluetooth helper returned an invalid response.");
      }
    };
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 65536) {
        fail("The Bluetooth helper exceeded its output limit.");
        return;
      }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const next = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (next) line(next);
      }
    });
    child.stdin!.on("error", () => {});
    child.stderr!.on("data", () => {});
    this.completion = new Promise<void>((resolve) => {
      const finish = async (code: number | null) => {
        if (finished) return;
        finished = true;
        clearInterval(watchdog);
        if (forceStop) clearTimeout(forceStop);
        if (buffer.trim()) line(buffer.trim());
        await writes;
        this.child = undefined;
        if (code !== 0 && !failed) {
          failed = true;
          this.update({
            phase: "error",
            message:
              "Windows could not maintain the band connection. Check wrist contact and Bluetooth, then reconnect.",
          });
        }
        this.update({
          running: false,
          ...(!failed
            ? {
                phase: "stopped",
                message:
                  "Monitoring stopped. Values shown are saved observations.",
              }
            : {}),
        });
        resolve();
      };
      child.once("error", () => {
        void finish(1);
      });
      child.once("close", (code) => {
        void finish(code);
      });
    });
    return this.status();
  }
  async stop() {
    if (!this.child) return this.status();
    const child = this.child;
    this.update({
      phase: "stopping",
      message: "Stopping measurement and releasing the band.",
    });
    child.stdin?.end("stop\n");
    const timeout = setTimeout(() => child.kill(), 20000);
    try {
      await this.completion;
    } finally {
      clearTimeout(timeout);
    }
    return this.status();
  }
}
