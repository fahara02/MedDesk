import { createCipheriv, createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { ClinicError } from "./consultations.js";

export interface SleepSession {
  date: string;
  start: string;
  end: string;
  deepMinutes?: number;
  lightMinutes?: number;
  score?: number;
  restingHeartRate?: number;
  source: "zepp-account";
  sourceHash: string;
}
export interface SleepHistory {
  sessions: SleepSession[];
  syncedAt?: string;
  status: "not-synced" | "synced" | "empty";
  sourceDays: number;
}
const integer = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : undefined;
export function parseSleepSummaries(rows: unknown): SleepSession[] {
  if (!Array.isArray(rows) || rows.length > 1000)
    throw new ClinicError("Zepp returned an unsupported sleep response.", 502);
  const sessions: SleepSession[] = [];
  for (const row of rows) {
    if (typeof row?.summary !== "string" || row.summary.length > 512000)
      continue;
    let summary;
    try {
      summary = JSON.parse(Buffer.from(row.summary, "base64").toString("utf8"));
    } catch {
      continue;
    }
    const sleep = summary?.slp;
    const start = integer(sleep?.st, 946684800, 4102444800);
    const end = integer(sleep?.ed, 946684800, 4102444800);
    if (
      !start ||
      !end ||
      end <= start ||
      end - start > 86400 ||
      typeof row.date_time !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date_time)
    )
      continue;
    sessions.push({
      date: row.date_time,
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
      deepMinutes: integer(sleep.dp, 0, 1440),
      lightMinutes: integer(sleep.lt, 0, 1440),
      score: integer(sleep.ss, 0, 100),
      restingHeartRate: integer(sleep.rhr, 25, 250),
      source: "zepp-account",
      sourceHash: createHash("sha256")
        .update(JSON.stringify(row))
        .digest("hex"),
    });
  }
  return sessions.sort((a, b) => b.end.localeCompare(a.end));
}

// Encrypted-login protocol parameters follow the bundled MIT-licensed huami-token
// implementation (Kirill Snezhko, 2025); see huami-token/LICENSE and constants.py.
async function login(envFile: string) {
  const config = parseEnv(await readFile(envFile, "utf8"));
  if (!config.EMAIL || !config.ZEPP_PASSWORD)
    throw new ClinicError(
      "EMAIL and ZEPP_PASSWORD are required in the local .env file to sync sleep.",
      400,
    );
  const parameters = new URLSearchParams({
    emailOrPhone: config.EMAIL,
    state: "REDIRECTION",
    client_id: "HuaMi",
    password: config.ZEPP_PASSWORD,
    redirect_uri:
      "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html",
    region: "us-west-2",
    country_code: "US",
  });
  parameters.append("token", "access");
  parameters.append("token", "refresh");
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from("xeNtBVqzDc6tuNTh"),
    Buffer.from("MAAAYAAAAAAAAABg"),
  );
  const encrypted = Buffer.concat([
    cipher.update(parameters.toString()),
    cipher.final(),
  ]);
  const response = await fetch(
    "https://api-user-us2.zepp.com/v2/registrations/tokens",
    {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: {
        app_name: "com.huami.midong",
        appname: "com.huami.midong",
        cv: "151689_9.12.5",
        v: "2.0",
        appplatform: "android_phone",
        vb: "202509151347",
        vn: "9.12.5",
        "user-agent": "Zepp/9.12.5 (Pixel 4; Android 12; Density/2.75)",
        "x-hm-ekv": "1",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: encrypted,
    },
  );
  if (response.status !== 303)
    throw new ClinicError(
      `Zepp login refused (HTTP ${response.status}). Check the Zepp account.`,
      502,
    );
  const location = response.headers.get("location");
  const token = location ? new URL(location).searchParams.get("access") : null;
  if (!token)
    throw new ClinicError("Zepp did not return an access token.", 502);
  const exchange = await fetch(
    "https://api-mifit-us2.zepp.com/v2/client/login",
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        app_name: "com.huami.webapp",
        appname: "com.huami.webapp",
        origin: "https://user.zepp.com",
        referer: "https://user.zepp.com/",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: new URLSearchParams({
        code: token,
        device_id: randomUUID(),
        device_model: "android_phone",
        app_version: "9.12.5",
        dn: "api-mifit.zepp.com,api-user.zepp.com,api-mifit.zepp.com,api-watch.zepp.com,app-analytics.zepp.com,auth.zepp.com,api-analytics.zepp.com",
        third_name: "huami",
        source: "com.huami.watch.hmwatchmanager:9.12.5:151689",
        app_name: "com.huami.midong",
        country_code: "US",
        grant_type: "access_token",
        allow_registration: "false",
        lang: "en",
        countryState: "US-NY",
      }),
    },
  );
  if (!exchange.ok)
    throw new ClinicError(
      `Zepp session exchange failed (HTTP ${exchange.status}).`,
      502,
    );
  const body = await exchange.json();
  const auth = body.token_info;
  if (!auth?.app_token || !auth.user_id)
    throw new ClinicError("Zepp did not establish a health-data session.", 502);
  return { token: String(auth.app_token), user: String(auth.user_id) };
}

export class SleepStore {
  private busy = false;
  constructor(
    private readonly directory: string,
    private readonly envFile: string,
  ) {}
  async get(): Promise<SleepHistory> {
    try {
      return JSON.parse(
        await readFile(path.join(this.directory, "sleep.json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { status: "not-synced", sessions: [], sourceDays: 0 };
      throw error;
    }
  }
  async sync(): Promise<SleepHistory> {
    if (this.busy) throw new ClinicError("Sleep sync is already running.", 409);
    this.busy = true;
    try {
      const auth = await login(this.envFile);
      const today = new Date();
      const prior = new Date(today);
      prior.setDate(prior.getDate() - 7);
      const localDate = (date: Date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const query = new URLSearchParams({
        query_type: "summary",
        device_type: "android_phone",
        userid: auth.user,
        from_date: localDate(prior),
        to_date: localDate(today),
      });
      const response = await fetch(
        `https://api-mifit-us2.zepp.com/v1/data/band_data.json?${query}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            apptoken: auth.token,
            appPlatform: "web",
            appname: "com.xiaomi.hm.health",
          },
        },
      );
      if (!response.ok)
        throw new ClinicError(
          `Zepp sleep retrieval failed (HTTP ${response.status}).`,
          502,
        );
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024)
        throw new ClinicError(
          "Zepp returned too much sleep data for this request.",
          502,
        );
      const body = JSON.parse(text);
      if (body.code !== 1 || !Array.isArray(body.data))
        throw new ClinicError(
          "Zepp did not return an accepted sleep-history response.",
          502,
        );
      const sessions = parseSleepSummaries(body.data);
      const value: SleepHistory = {
        sessions,
        sourceDays: body.data.length,
        syncedAt: new Date().toISOString(),
        status: sessions.length ? "synced" : "empty",
      };
      await mkdir(this.directory, { recursive: true });
      await writeFile(path.join(this.directory, "sleep-source.json"), text, {
        mode: 0o600,
      });
      const temporary = path.join(this.directory, "sleep.json.tmp");
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, path.join(this.directory, "sleep.json"));
      return value;
    } finally {
      this.busy = false;
    }
  }
}
