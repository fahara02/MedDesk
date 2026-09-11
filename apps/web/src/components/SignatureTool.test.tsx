// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SignatureTool } from "./SignatureTool";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("loads a private saved signature for explicit placement", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([255,216,255,224]), { headers: { "Content-Type": "image/jpeg" } })));
  const place = vi.fn();
  render(<SignatureTool onPlace={place} disabled={false} />);
  const image = await screen.findByAltText("Signature ready to place");
  expect(image.getAttribute("src")).toBe("data:image/jpeg;base64,/9j/4A==");
  expect(place).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Place signature" }));
  expect(place).toHaveBeenCalledExactlyOnceWith("data:image/jpeg;base64,/9j/4A==");
});

it("a delayed saved signature cannot replace a newly uploaded signature", async () => {
  let finish: (value: Response) => void = () => {};
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  render(<SignatureTool onPlace={vi.fn()} disabled={false} />);
  fireEvent.change(screen.getByLabelText("Upload image"), { target: { files: [new File([new Uint8Array([255,216,255,225])], "chosen.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(screen.getByAltText("Signature ready to place").getAttribute("src")).toBe("data:image/jpeg;base64,/9j/4Q=="));
  finish(new Response(new Uint8Array([255,216,255,224]), { headers: { "Content-Type": "image/jpeg" } }));
  await screen.findByRole("button", { name: "Use saved signature" });
  expect(screen.getByAltText("Signature ready to place").getAttribute("src")).toBe("data:image/jpeg;base64,/9j/4Q==");
});
