import { workspaceFetch } from "./session";

export async function loadSavedSignature(signal: AbortSignal): Promise<string | undefined> {
  const response = await workspaceFetch("/api/prescriber/signature", { signal });
  if (!response.ok || !/^image\/(jpeg|png)/.test(response.headers.get("content-type") || "")) return;
  const blob = await response.blob();
  if (!blob.size || blob.size > 200000 || signal.aborted) return;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The saved signature could not be opened."));
    reader.onload = () => resolve(signal.aborted ? undefined : String(reader.result));
    reader.readAsDataURL(blob);
  });
}
