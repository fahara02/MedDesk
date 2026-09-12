import { parseConsultation, type ConsultationInput } from "./clinical-model.js";

// Private demonstration container. See DEMO-LPS.md for its experimental CORE
// contract and the distinction from the registered, signed native writer.
export const DEMO_LPS_PROFILE = 0x4d440001;
export const DEMO_LPS_LIMIT = 1024 * 1024;
const signature = Uint8Array.of(0x8d, 0x4c, 0x50, 0x53, 13, 10, 26, 10);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const failure = () => new Error("Choose an intact MedDesk demo LPS file (unsigned, private demo profile).");

export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// Only the JSON-shaped subset needed by the editable document is admitted.
// No floats, tags, indefinite lengths, byte strings or executable content.
function encodeCbor(value: unknown): Uint8Array {
  const out: number[] = [];
  let nodes = 0;
  const header = (major: number, n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) throw failure();
    if (n < 24) out.push(major * 32 + n);
    else if (n < 256) out.push(major * 32 + 24, n);
    else if (n < 65536) out.push(major * 32 + 25, n >>> 8, n & 255);
    else out.push(major * 32 + 26, n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  };
  const put = (item: unknown, depth: number) => {
    if (depth > 40 || ++nodes > 20000 || out.length > DEMO_LPS_LIMIT) throw failure();
    if (item === null) { out.push(246); return; }
    if (typeof item === "boolean") { out.push(item ? 245 : 244); return; }
    if (typeof item === "number") { header(item < 0 ? 1 : 0, item < 0 ? -1 - item : item); return; }
    if (typeof item === "string") {
      const bytes = encoder.encode(item);
      if (bytes.length > DEMO_LPS_LIMIT || decoder.decode(bytes) !== item) throw failure();
      header(3, bytes.length);
      for (const byte of bytes) out.push(byte);
      return;
    }
    if (Array.isArray(item)) {
      header(4, item.length);
      for (const child of item) put(child, depth + 1);
      return;
    }
    if (typeof item !== "object" || !item) throw failure();
    const entries = Object.entries(item).filter(([, child]) => child !== undefined)
      .map(([key, child]) => ({ key, child, bytes: encodeCbor(key) }))
      .sort((a, b) => compare(a.bytes, b.bytes));
    header(5, entries.length);
    for (const { key, child } of entries) { put(key, depth + 1); put(child, depth + 1); }
  };
  put(value, 0);
  if (out.length > DEMO_LPS_LIMIT) throw failure();
  return Uint8Array.from(out);
}

function decodeCbor(bytes: Uint8Array): unknown {
  let offset = 0, nodes = 0;
  const next = () => { if (offset >= bytes.length) throw failure(); return bytes[offset++]; };
  const read = (depth: number): unknown => {
    if (depth > 40 || ++nodes > 20000) throw failure();
    const first = next(), major = first >>> 5, info = first & 31;
    if (first === 244 || first === 245) return first === 245;
    if (first === 246) return null;
    if (major > 5 || major === 2 || info > 26) throw failure();
    let n = info;
    if (info >= 24) {
      n = 0;
      for (let i = 0; i < 2 ** (info - 24); i++) n = n * 256 + next();
    }
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (n > bytes.length - offset) throw failure();
    if (major === 3) { const text = decoder.decode(bytes.subarray(offset, offset + n)); offset += n; return text; }
    if (n > 20000) throw failure();
    if (major === 4) return Array.from({ length: n }, () => read(depth + 1));
    const result: Record<string, unknown> = Object.create(null);
    for (let i = 0; i < n; i++) {
      const key = read(depth + 1);
      if (typeof key !== "string" || Object.hasOwn(result, key)) throw failure();
      result[key] = read(depth + 1);
    }
    return result;
  };
  const result = read(0);
  if (offset !== bytes.length || compare(encodeCbor(result), bytes) !== 0) throw failure();
  return result;
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + 16), view = new DataView(bytes.buffer);
  bytes.set(encoder.encode(type)); view.setUint32(4, payload.length, true);
  bytes.set(payload, 12); view.setUint32(bytes.length - 4, crc32c(bytes.subarray(0, -4)), true);
  return bytes;
}

function checkedDraft(value: unknown): ConsultationInput {
  const draft = parseConsultation(value, true);
  if (!draft) throw new Error("The prescription contains invalid or inconsistent fields. Review it before exporting.");
  if (!draft.synthetic || draft.vitalReadingIds.length || draft.sources.length) {
    throw new Error("Demo LPS export accepts fictional consultations without linked device readings or source files only.");
  }
  return draft;
}

export function encodeDemoLps(value: ConsultationInput): Uint8Array<ArrayBuffer> {
  const draft = checkedDraft(value);
  const core = encodeCbor({ format: "meddesk-demo/1", environment: "sample", status: "unsigned-draft", draft });
  const head = new Uint8Array(32), view = new DataView(head.buffer);
  view.setUint16(0, 1, true); view.setUint32(4, DEMO_LPS_PROFILE, true);
  head.set(encoder.encode("BD"), 8); head[10] = 1;
  view.setUint16(14, 2, true); view.setBigUint64(16, BigInt(32 + core.length), true);
  view.setUint32(24, 128, true); head[28] = 1;
  const chunks = [chunk("HEAD", head), chunk("CORE", core)];
  const bytes = new Uint8Array(8 + chunks.reduce((n, item) => n + item.length, 0));
  if (bytes.length > DEMO_LPS_LIMIT) throw failure();
  bytes.set(signature); let offset = 8;
  for (const item of chunks) { bytes.set(item, offset); offset += item.length; }
  return bytes;
}

export function decodeDemoLps(bytes: Uint8Array): ConsultationInput {
  if (bytes.length > DEMO_LPS_LIMIT || bytes.length < 73 || compare(bytes.subarray(0, 8), signature)) throw failure();
  let offset = 8;
  const take = (type: string) => {
    if (bytes.length - offset < 16) throw failure();
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset);
    const size = view.getUint32(4, true);
    if (size > bytes.length - offset - 16 || decoder.decode(bytes.subarray(offset, offset + 4)) !== type || view.getUint32(8, true) !== 0) throw failure();
    const end = offset + size + 16;
    if (crc32c(bytes.subarray(offset, end - 4)) !== view.getUint32(size + 12, true)) throw failure();
    const payload = bytes.subarray(offset + 12, end - 4); offset = end; return payload;
  };
  const head = take("HEAD");
  if (head.length !== 32) throw failure();
  const view = new DataView(head.buffer, head.byteOffset, head.length);
  if (view.getUint16(0, true) !== 1 || view.getUint16(2, true) !== 0 || view.getUint32(4, true) !== DEMO_LPS_PROFILE ||
      head[8] !== 66 || head[9] !== 68 || head[10] !== 1 || head[11] !== 0 || view.getUint16(12, true) !== 0 ||
      view.getUint16(14, true) !== 2 || view.getUint32(24, true) !== 128 || view.getUint32(28, true) !== 1) throw failure();
  const core = take("CORE");
  if (offset !== bytes.length || view.getBigUint64(16, true) !== BigInt(32 + core.length)) throw failure();
  const value = decodeCbor(core) as { format?: unknown; environment?: unknown; status?: unknown; draft?: unknown } | null;
  if (!value || value.format !== "meddesk-demo/1" || value.environment !== "sample" || value.status !== "unsigned-draft") throw failure();
  return checkedDraft(value.draft);
}
