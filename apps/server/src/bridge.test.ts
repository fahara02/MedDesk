import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { BridgeRegistry } from "./bridge-registry.js";
import { BridgeQueue } from "./bridge-queue.js";

const observation = () => ({
  source: "band" as const,
  observedAt: new Date(Date.now() - 60_000).toISOString(),
  heartRate: 74,
  deviceName: "Synthetic test fixture",
});
test("desktop enrollment, durable retry identity, PC separation, and revocation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meddesk-bridge-"));
  let registry = new BridgeRegistry(path.join(directory, "registry.sqlite"));
  try {
    const invite = registry.invite("Test room");
    const first = registry.enroll(invite.code);
    assert.throws(() => registry.enroll(invite.code), /invalid or expired/);
    assert.throws(
      () => registry.authenticate("Bearer invalid"),
      /missing or revoked/,
    );
    assert.equal(registry.authenticate("Bearer " + first.token), first.id);
    const second = registry.enroll(registry.invite("Another PC").code);
    const reading = observation(),
      id = randomUUID();
    const body = {
      readings: [{ id, reading }],
      status: {
        running: true,
        phase: "measuring",
        startedAt: reading.observedAt,
      },
    };
    assert.deepEqual(registry.receive(first.id, body).accepted, [id]);
    const saved = registry.pending()[0];
    assert.match(saved.id, /^[a-f0-9-]{36}$/);
    assert.equal(saved.bridgeId, first.id);
    assert.equal(saved.observedAt, reading.observedAt);
    registry.published(saved.id);
    registry.close();
    registry = new BridgeRegistry(path.join(directory, "registry.sqlite"));
    registry.receive(first.id, body);
    assert.equal(registry.pending().length, 0);
    assert.equal(registry.latest(first.id, 10).length, 1);
    assert.equal(registry.get(saved.id)?.receivedAt, saved.receivedAt);
    registry.receive(second.id, body);
    assert.notEqual(registry.latest(second.id, 10)[0].id, saved.id);
    assert.throws(
      () =>
        registry.receive(first.id, {
          readings: [{ id, reading: { ...reading, heartRate: 120 } }],
        }),
      /identity/,
    );
    const duplicate = randomUUID();
    assert.throws(
      () =>
        registry.receive(first.id, {
          readings: [
            { id: duplicate, reading },
            { id: duplicate, reading: { ...reading, heartRate: 120 } },
          ],
        }),
      /identity/,
    );
    assert.throws(
      () =>
        registry.receive(first.id, {
          readings: [
            { id: randomUUID(), reading: { ...reading, source: "demo" } },
          ],
        }),
      /Invalid band/,
    );
    assert.throws(
      () =>
        registry.receive(first.id, {
          readings: [
            {
              id: randomUUID(),
              reading: {
                ...reading,
                observedAt: new Date(Date.now() + 120_000).toISOString(),
              },
            },
          ],
        }),
      /future/,
    );
    registry.command(first.id, false);
    assert.equal(
      registry.receive(first.id, { readings: [], status: {} }).desiredRunning,
      false,
    );
    registry.revoke(first.id);
    assert.equal(registry.status(first.id).running, false);
    assert.throws(
      () => registry.authenticate("Bearer " + first.token),
      /revoked/,
    );
    assert.ok(!JSON.stringify(registry.devices()).includes(first.token));
  } finally {
    registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("offline queue survives restart, stops at capacity, and removes only acknowledged rows", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meddesk-queue-"));
  let queue = new BridgeQueue(path.join(directory, "queue.sqlite"), 3);
  try {
    queue.add(observation());
    const first = queue.batch();
    queue.add(observation());
    queue.close();
    queue = new BridgeQueue(path.join(directory, "queue.sqlite"), 3);
    assert.equal(queue.count(), 2);
    queue.acknowledge(first.map((r) => r.id));
    assert.equal(queue.count(), 1);
    queue.add(observation());
    queue.add(observation());
    assert.throws(() => queue.add(observation()), /full/);
    assert.equal(queue.count(), 3);
    assert.ok(
      queue.batch().every((item) => !first.some((old) => old.id === item.id)),
    );
  } finally {
    queue.close();
    await rm(directory, { recursive: true, force: true });
  }
});
