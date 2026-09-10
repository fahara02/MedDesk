export type ConnectionPhase =
  | "idle"
  | "selecting"
  | "connecting"
  | "authenticating"
  | "connected"
  | "disconnected"
  | "error"
  | "demo";

export interface Reading {
  id?: string;
  observedAt: string;
  receivedAt?: string;
  source: "band" | "demo";
  deviceName?: string;
  heartRate?: number;
  steps?: number;
  distanceMeters?: number;
  calories?: number;
  batteryPercent?: number;
}

export interface BandSnapshot extends Omit<Reading, "observedAt" | "source"> {
  observedAt?: string;
}
