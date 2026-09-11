// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SessionGate from "./SessionGate";

vi.mock("./App", () => ({ default: ({ onLogout }: { onLogout?: () => void }) => <div>Private workspace{onLogout && <button onClick={onLogout}>Sign out</button>}</div> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
const json = (value: object, status = 200) => new Response(JSON.stringify(value), { status });

it("shows branded login before mounting patient data, then signs in and out without storing credentials", async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/session")) return json({ enabled: true, authenticated: false });
    if (url.endsWith("/login")) {
      expect(JSON.parse(init!.body as string)).toEqual({ username: "test-doctor", password: "test-password" });
      return json({ enabled: true, authenticated: true });
    }
    return json({ authenticated: false });
  });
  vi.stubGlobal("fetch", fetch);
  render(<SessionGate />);
  expect(screen.queryByText("Private workspace")).toBeNull();
  await waitFor(() => expect((screen.getByLabelText("Username") as HTMLInputElement).disabled).toBe(false));
  expect(screen.getByAltText(/Labaid Cancer/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "test-doctor" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("text");
  fireEvent.submit(screen.getByRole("form", { name: "Sign in" }));
  await screen.findByText("Private workspace");
  expect(JSON.stringify(localStorage)).not.toContain("test-password");
  fireEvent.click(screen.getByText("Sign out"));
  await screen.findByText("You’ve signed out of your workspace.");
  expect(screen.queryByText("Private workspace")).toBeNull();
});

it("shows a failed login inline and locks a restored session on expiration", async () => {
  let authenticated = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/session")
    ? json({ enabled: true, authenticated }) : json({ error: "The username or password is incorrect." }, 401)));
  render(<SessionGate />);
  await waitFor(() => expect((screen.getByLabelText("Username") as HTMLInputElement).disabled).toBe(false));
  fireEvent.submit(screen.getByRole("form", { name: "Sign in" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Private workspace")).toBeNull();
  authenticated = true;
  fireEvent.focus(window);
  await screen.findByText("Private workspace");
  act(() => window.dispatchEvent(new Event("meddesk:sign-in-required")));
  expect(screen.queryByText("Private workspace")).toBeNull();
  expect(screen.getByText("Please sign in again to continue your work.")).toBeTruthy();
});

it("keeps local mode open and offers retry when the session endpoint cannot be reached", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(json({ enabled: false, authenticated: true }));
  vi.stubGlobal("fetch", fetch);
  render(<SessionGate />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Try again"));
  await screen.findByText("Private workspace");
  expect(screen.queryByText("Sign out")).toBeNull();
});
