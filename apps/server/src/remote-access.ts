import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function remoteAccess(
  origin: string | undefined,
  secret: string | undefined,
): RequestHandler {
  if (
    origin &&
    (!/^https:\/\/[a-z0-9.-]+$/.test(origin) || !secret || secret.length < 32)
  )
    throw new Error(
      "Remote mode requires an HTTPS origin and a strong reverse-proxy secret.",
    );
  return (request, response, next) => {
    if (!origin) return next();
    if (
      request.method === "POST" &&
      ["/api/bridge/enroll", "/api/bridge/uplink"].includes(request.path)
    )
      return next();
    if (request.path === "/api/health" && request.method === "GET")
      return next();
    const provided = Buffer.from(request.get("X-MedDesk-Proxy") || "");
    const expected = Buffer.from(secret!);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      response
        .status(401)
        .json({ error: "Sign in through the MedDesk HTTPS site." });
      return;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.get("Origin") &&
      request.get("Origin") !== origin
    ) {
      response
        .status(403)
        .json({ error: "This request came from another website." });
      return;
    }
    next();
  };
}
