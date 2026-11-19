import { describe, expect, it } from "vitest";
import {
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  type DeviceRow,
  type DeviceStore,
  decideDevice,
  normalizeUserCode,
  pendingDevice,
  pollDevice,
  startDevice,
} from "./device";

function memoryStore() {
  const rows = new Map<string, DeviceRow>();
  const store: DeviceStore = {
    insert: async (row) => void rows.set(row.device_code_hash, { ...row }),
    byHash: async (hash) => rows.get(hash) ?? null,
    byUserCode: async (code) =>
      [...rows.values()].find((row) => row.user_code === code) ?? null,
    update: async (row) => void rows.set(row.device_code_hash, { ...row }),
    remove: async (hash) => void rows.delete(hash),
    removeExpired: async (now) => {
      for (const [hash, row] of rows)
        if (row.expires_at <= now) rows.delete(hash);
    },
  };
  return { rows, store };
}

const NOW = 1_000_000;
const ALICE = {
  sub: "7",
  email: "alice@example.com",
  name: "Alice",
  picture: null,
};

describe("user codes", () => {
  it("normalizes case, spaces and dashes", () => {
    expect(normalizeUserCode("bcdf ghjk")).toBe("BCDF-GHJK");
    expect(normalizeUserCode("BCDF-GHJK")).toBe("BCDF-GHJK");
  });

  it("rejects wrong length and letters outside the alphabet", () => {
    expect(normalizeUserCode("BCDF-GHJ")).toBeNull();
    expect(normalizeUserCode("ABCD-EFGH")).toBeNull();
  });
});

describe("device flow", () => {
  it("issues a code the user can find and stores only its hash", async () => {
    const { rows, store } = memoryStore();
    const { deviceCode, userCode } = await startDevice(store, " TV ", NOW);
    expect(userCode).toMatch(
      /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
    );
    const row = [...rows.values()][0];
    expect(row.device_code_hash).not.toBe(deviceCode);
    expect(row.client_name).toBe("TV");
    expect(row.expires_at).toBe(NOW + DEVICE_CODE_TTL_SECONDS);
    expect(await pendingDevice(store, userCode.toLowerCase(), NOW)).toEqual(
      row,
    );
  });

  it("stays pending, slows down fast pollers, then hands the token once", async () => {
    const { store } = memoryStore();
    const { deviceCode, userCode } = await startDevice(store, "", NOW);
    expect((await pollDevice(store, deviceCode, NOW)).status).toBe(
      "authorization_pending",
    );
    expect((await pollDevice(store, deviceCode, NOW + 1)).status).toBe(
      "slow_down",
    );
    expect(await decideDevice(store, userCode, ALICE, true, NOW + 2)).toBe(
      true,
    );
    expect(await decideDevice(store, userCode, ALICE, true, NOW + 3)).toBe(
      false,
    );
    expect(
      await pollDevice(
        store,
        deviceCode,
        NOW + 2 * DEVICE_POLL_INTERVAL_SECONDS,
      ),
    ).toEqual({ status: "approved", identity: ALICE });
    expect((await pollDevice(store, deviceCode, NOW + 60)).status).toBe(
      "invalid_grant",
    );
  });

  it("reports a denied request and forgets it", async () => {
    const { store } = memoryStore();
    const { deviceCode, userCode } = await startDevice(store, "", NOW);
    expect(await decideDevice(store, userCode, ALICE, false, NOW)).toBe(true);
    expect((await pollDevice(store, deviceCode, NOW)).status).toBe(
      "access_denied",
    );
    expect((await pollDevice(store, deviceCode, NOW)).status).toBe(
      "invalid_grant",
    );
  });

  it("expires codes for both the user and the device", async () => {
    const { store } = memoryStore();
    const { deviceCode, userCode } = await startDevice(store, "", NOW);
    const later = NOW + DEVICE_CODE_TTL_SECONDS;
    expect(await pendingDevice(store, userCode, later)).toBeNull();
    expect(await decideDevice(store, userCode, ALICE, true, later)).toBe(false);
    expect((await pollDevice(store, deviceCode, later)).status).toBe(
      "expired_token",
    );
  });

  it("does not accept an unknown device code", async () => {
    const { store } = memoryStore();
    expect((await pollDevice(store, "nope", NOW)).status).toBe("invalid_grant");
  });
});
