import { describe, it, expect } from "@jest/globals";
import { memoryStore } from "../src/data/memoryStore.js";
import * as userRepo from "../src/repositories/userRepository.js";
import * as messageRepo from "../src/repositories/messageRepository.js";
import * as resetTokenRepo from "../src/repositories/resetTokenRepository.js";
import * as paymentRepo from "../src/repositories/paymentRepository.js";

describe("userRepository (memory)", () => {
  it("should create and find users with normalized fields", async () => {
    const user = await userRepo.createUser({
      name: "  Neo  ",
      email: "  NEO@EXAMPLE.COM  ",
      passwordHash: "hash-1",
    });

    expect(user.name).toBe("Neo");
    expect(user.email).toBe("neo@example.com");

    const byEmail = await userRepo.findByEmail("NEO@example.com");
    expect(byEmail?.id).toBe(user.id);

    const byId = await userRepo.findById(user.id);
    expect(byId?.email).toBe("neo@example.com");

    expect(userRepo.normalizeEmail(" A@B.COM ")).toBe("a@b.com");
    expect(userRepo.normalizeUserId({ _id: "mongo-id" })).toBe("mongo-id");
    expect(userRepo.normalizeUserId({ id: "mem-id" })).toBe("mem-id");
  });

  it("should manage sessions and profile fields", async () => {
    const user = await userRepo.createUser({
      name: "Trinity",
      email: "trinity@example.com",
      passwordHash: "hash",
    });

    userRepo.addSession(
      user,
      {
        tokenHash: "expired-token",
        expiresAt: new Date(Date.now() - 1000),
      },
      "old-agent"
    );

    userRepo.addSession(
      user,
      {
        tokenHash: "valid-token",
        expiresAt: new Date(Date.now() + 1000 * 60),
      },
      "ua-agent"
    );

    await userRepo.save(user);
    expect(user.activeTokens.length).toBe(1);
    expect(user.activeTokens[0].tokenHash).toBe("valid-token");

    const byHash = await userRepo.findBySessionTokenHash("valid-token");
    expect(byHash?.id).toBe(user.id);

    userRepo.setPreferredMode(user, "Shayari");
    userRepo.updateProfileName(user, "The One");
    userRepo.setTier(user, "Premium");
    userRepo.setPasswordHash(user, "hash-2");
    userRepo.setGoogleSub(user, "google-sub");
    userRepo.incrementMessageCount(user);
    userRepo.setProfileImageUrl(user, "https://img.example.com/a.jpg");
    userRepo.setUpgradeAssetUrl(user, "https://img.example.com/b.jpg");

    const safeUser = userRepo.toSafeUser(user);
    expect(safeUser.mode).toBe("Shayari");
    expect(safeUser.name).toBe("The One");
    expect(safeUser.tier).toBe("Premium");
    expect(safeUser.messageCount).toBe(1);
    expect(safeUser.profileImageUrl).toContain("img.example.com");
    expect(safeUser.upgradeAssetUrl).toContain("img.example.com");

    userRepo.removeSessionByHash(user, "valid-token");
    expect(user.activeTokens.length).toBe(0);

    userRepo.clearAllSessions(user);
    expect(user.activeTokens.length).toBe(0);
  });

  it("should find by google sub and return null for unknown ids", async () => {
    await userRepo.createUser({
      name: "Sub User",
      email: "sub@example.com",
      googleSub: "sub-123",
    });

    const bySub = await userRepo.findByGoogleSub("sub-123");
    expect(bySub?.email).toBe("sub@example.com");

    expect(await userRepo.findByGoogleSub("")).toBeNull();
    expect(await userRepo.findById("")).toBeNull();
    expect(await userRepo.findBySessionTokenHash("")).toBeNull();
    expect(await userRepo.findByEmail("")).toBeNull();
    expect(await userRepo.save(null)).toBeNull();
  });
});

describe("messageRepository (memory)", () => {
  it("should create, list, filter by ids and remove messages", async () => {
    const first = await messageRepo.create({
      userId: "u1",
      mode: "Lovely",
      role: "user",
      cipherText: "c1",
      iv: "i1",
      authTag: "a1",
      contentHash: "h1",
    });

    await new Promise((resolve) => setTimeout(resolve, 2));

    const second = await messageRepo.create({
      userId: "u1",
      mode: "Lovely",
      role: "kanchana",
      cipherText: "c2",
      iv: "i2",
      authTag: "a2",
      contentHash: "h2",
      vectorId: "v2",
    });

    await messageRepo.create({
      userId: "u1",
      mode: "Horror",
      role: "user",
      cipherText: "c3",
      iv: "i3",
      authTag: "a3",
      contentHash: "h3",
    });

    const recent = await messageRepo.listRecentByUserMode({
      userId: "u1",
      mode: "Lovely",
      limit: 5,
    });
    expect(recent.length).toBe(2);
    expect(recent[0].id).toBe(second.id);

    const byIds = await messageRepo.listByIds({
      userId: "u1",
      ids: [first.id, second.id, ""],
    });
    expect(byIds.length).toBe(2);
    expect(messageRepo.normalizeMessageId({ _id: "m1" })).toBe("m1");
    expect(messageRepo.normalizeMessageId({ id: "m2" })).toBe("m2");

    const emptyIds = await messageRepo.listByIds({ userId: "u1", ids: [] });
    expect(emptyIds).toEqual([]);

    const deleted = await messageRepo.removeByUserMode({ userId: "u1", mode: "Lovely" });
    expect(deleted).toBe(2);

    const left = memoryStore.messages.filter((item) => item.userId === "u1");
    expect(left.length).toBe(1);
  });
});

describe("resetTokenRepository (memory)", () => {
  it("should create, find active, mark used and invalidate user tokens", async () => {
    const active = await resetTokenRepo.create({
      userId: "u1",
      tokenHash: "hash-active",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await resetTokenRepo.create({
      userId: "u1",
      tokenHash: "hash-expired",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const found = await resetTokenRepo.findActiveByTokenHash("hash-active");
    expect(found?.id).toBe(active.id);

    const notFound = await resetTokenRepo.findActiveByTokenHash("hash-expired");
    expect(notFound).toBeNull();

    const marked = await resetTokenRepo.markUsed(active);
    expect(marked?.usedAt).toBeTruthy();
    expect(await resetTokenRepo.markUsed(null)).toBeNull();

    await resetTokenRepo.invalidateUserTokens("u1");
    const activeAfterInvalidate = memoryStore.resetTokens.filter(
      (item) => item.userId === "u1" && !item.usedAt
    );
    expect(activeAfterInvalidate.length).toBe(0);
  });
});

describe("paymentRepository (memory)", () => {
  it("should create, find and save payments", async () => {
    const payment = await paymentRepo.create({
      userId: "u-payment",
      provider: "paypal",
      flow: "order",
      providerRef: "order-1",
      metadataCipherText: "ct",
      metadataIv: "iv",
      metadataAuthTag: "tag",
    });

    expect(payment.currency).toBe("INR");
    expect(payment.amount).toBe(0);

    const found = await paymentRepo.findByProviderRef("order-1");
    expect(found?.id).toBe(payment.id);
    expect(await paymentRepo.findByProviderRef("")).toBeNull();

    const updated = await paymentRepo.save(found);
    expect(updated?.updatedAt).toBeTruthy();
    expect(await paymentRepo.save(null)).toBeNull();
  });
});
