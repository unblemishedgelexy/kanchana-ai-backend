import { describe, it, expect, jest } from "@jest/globals";

const VECTOR_KEYS = ["PINECONE_API_KEY", "PINECONE_INDEX"];

const clearVectorEnv = () => {
  VECTOR_KEYS.forEach((key) => {
    delete process.env[key];
  });
};

describe("vectorMemoryService", () => {
  it("should no-op and return empty results when not configured", async () => {
    clearVectorEnv();
    jest.resetModules();

    const service = await import("../src/services/vectorMemoryService.js");
    expect(service.vectorMemoryEnabled).toBe(false);

    const upsertResult = await service.upsertMessageVector({
      userId: "u1",
      messageId: "m1",
      mode: "Lovely",
      text: "hello",
    });
    expect(upsertResult).toBeUndefined();

    const queryResult = await service.queryRelevantMessageIds({
      userId: "u1",
      mode: "Lovely",
      text: "hello",
    });
    expect(queryResult).toEqual([]);
  });

  it("should upsert/query vectors when configured and embedding is available", async () => {
    clearVectorEnv();
    process.env.PINECONE_API_KEY = "pine-key";
    process.env.PINECONE_INDEX = "kanchana-index";

    const upsertMock = jest.fn(async () => ({ upsertedCount: 1 }));
    const queryMock = jest.fn(async () => ({
      matches: [{ id: "m-1" }, { id: "m-2" }, { id: "" }],
    }));
    const namespaceMock = jest.fn(() => ({
      upsert: upsertMock,
      query: queryMock,
    }));
    const indexMock = jest.fn(() => ({
      namespace: namespaceMock,
    }));
    const createEmbeddingMock = jest
      .fn()
      .mockResolvedValueOnce([0.1, 0.2, 0.3])
      .mockResolvedValueOnce([0.4, 0.5, 0.6]);

    jest.resetModules();
    jest.unstable_mockModule("@pinecone-database/pinecone", () => ({
      Pinecone: class FakePinecone {
        Index(name) {
          return indexMock(name);
        }
      },
    }));
    jest.unstable_mockModule("../src/services/geminiService.js", () => ({
      createEmbedding: createEmbeddingMock,
    }));

    const service = await import("../src/services/vectorMemoryService.js");
    expect(service.vectorMemoryEnabled).toBe(true);

    await service.upsertMessageVector({
      userId: "u1",
      messageId: "m1",
      mode: "Lovely",
      text: "my first message",
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);

    const ids = await service.queryRelevantMessageIds({
      userId: "u1",
      mode: "Lovely",
      text: "find memories",
      topK: 2,
    });
    expect(ids).toEqual(["m-1", "m-2"]);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("should skip vector writes/queries when embedding is empty", async () => {
    clearVectorEnv();
    process.env.PINECONE_API_KEY = "pine-key";
    process.env.PINECONE_INDEX = "kanchana-index";

    const upsertMock = jest.fn(async () => ({}));
    const queryMock = jest.fn(async () => ({ matches: [{ id: "x" }] }));
    const namespaceMock = jest.fn(() => ({
      upsert: upsertMock,
      query: queryMock,
    }));
    const indexMock = jest.fn(() => ({
      namespace: namespaceMock,
    }));
    const createEmbeddingMock = jest.fn(async () => []);

    jest.resetModules();
    jest.unstable_mockModule("@pinecone-database/pinecone", () => ({
      Pinecone: class FakePinecone {
        Index(name) {
          return indexMock(name);
        }
      },
    }));
    jest.unstable_mockModule("../src/services/geminiService.js", () => ({
      createEmbedding: createEmbeddingMock,
    }));

    const service = await import("../src/services/vectorMemoryService.js");
    await service.upsertMessageVector({
      userId: "u2",
      messageId: "m2",
      mode: "Chill",
      text: "text",
    });
    expect(upsertMock).not.toHaveBeenCalled();

    const ids = await service.queryRelevantMessageIds({
      userId: "u2",
      mode: "",
      text: "query text",
    });
    expect(ids).toEqual([]);
  });
});
