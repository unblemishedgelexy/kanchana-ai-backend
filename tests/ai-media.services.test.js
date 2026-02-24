import { describe, it, expect, jest } from "@jest/globals";

const IMAGEKIT_KEYS = [
  "IMAGEKIT_PUBLIC_KEY",
  "IMAGEKIT_PRIVATE_KEY",
  "IMAGEKIT_URL_ENDPOINT",
];

const GEMINI_KEYS = ["GEMINI_API_KEY", "GEMINI_CHAT_MODEL", "GEMINI_IMAGE_MODEL", "GEMINI_EMBED_MODEL"];
const GOOGLE_KEYS = ["GOOGLE_CLIENT_ID"];

const clearEnvKeys = (keys) => {
  keys.forEach((key) => {
    delete process.env[key];
  });
};

const makeJsonResponse = ({ ok = true, payload = {} } = {}) => ({
  ok,
  text: async () => JSON.stringify(payload),
  json: async () => payload,
});

describe("imageKitService", () => {
  it("should throw when imagekit is not configured", async () => {
    clearEnvKeys(IMAGEKIT_KEYS);
    jest.resetModules();

    const service = await import("../src/services/imageKitService.js");
    expect(service.isImageKitConfigured()).toBe(false);

    expect(() => service.getImageKitUploadAuth()).toThrow("ImageKit is not configured");
    await expect(
      service.uploadImageUrlToImageKit({
        imageUrl: "https://example.com/a.jpg",
        fileName: "a",
      })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("should provide auth and upload from data uri or url", async () => {
    clearEnvKeys(IMAGEKIT_KEYS);
    process.env.IMAGEKIT_PUBLIC_KEY = "public";
    process.env.IMAGEKIT_PRIVATE_KEY = "private";
    process.env.IMAGEKIT_URL_ENDPOINT = "https://ik.imagekit.io/demo";

    const authMock = jest.fn(() => ({
      token: "ik-token",
      expire: Date.now() + 60_000,
      signature: "ik-signature",
    }));
    const uploadMock = jest.fn(async () => ({
      url: "https://ik.imagekit.io/demo/file.jpg",
      thumbnailUrl: "https://ik.imagekit.io/demo/file_thumb.jpg",
      fileId: "file-id-1",
    }));

    jest.resetModules();
    jest.unstable_mockModule("@imagekit/nodejs", () => ({
      default: class FakeImageKit {
        getAuthenticationParameters(payload) {
          return authMock(payload);
        }

        upload(payload) {
          return uploadMock(payload);
        }
      },
    }));

    const service = await import("../src/services/imageKitService.js");
    expect(service.isImageKitConfigured()).toBe(true);

    const auth = service.getImageKitUploadAuth({ userId: "u1" });
    expect(auth.token).toBe("ik-token");
    expect(auth.publicKey).toBe("public");

    await expect(
      service.uploadDataUriToImageKit({
        dataUri: "invalid-data-uri",
        fileName: "invalid",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const fromDataUri = await service.uploadDataUriToImageKit({
      dataUri: "data:image/png;base64,abcd1234",
      fileName: "profile-image",
      folder: "/users/u1",
      tags: ["profile"],
    });
    expect(fromDataUri.url).toContain("imagekit.io");

    const fromUrl = await service.uploadImageUrlToImageKit({
      imageUrl: "https://example.com/image.jpg",
      fileName: "remote-image",
      tags: ["chat"],
    });
    expect(fromUrl.fileId).toBe("file-id-1");
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });
});

describe("googleAuthService", () => {
  it("should reject when google auth is not configured", async () => {
    clearEnvKeys(GOOGLE_KEYS);
    jest.resetModules();
    const service = await import("../src/services/googleAuthService.js");

    await expect(service.verifyGoogleIdToken("token")).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("should validate id token payload from google", async () => {
    clearEnvKeys(GOOGLE_KEYS);
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    const verifyIdTokenMock = jest.fn(async () => ({
      getPayload: () => ({
        sub: "google-sub",
        email: "neo@example.com",
        name: "Neo",
        email_verified: true,
      }),
    }));

    jest.resetModules();
    jest.unstable_mockModule("google-auth-library", () => ({
      OAuth2Client: class FakeOAuth2Client {
        verifyIdToken(args) {
          return verifyIdTokenMock(args);
        }
      },
    }));

    const service = await import("../src/services/googleAuthService.js");

    await expect(service.verifyGoogleIdToken("")).rejects.toMatchObject({
      statusCode: 400,
    });

    const valid = await service.verifyGoogleIdToken("id-token-1");
    expect(valid.googleSub).toBe("google-sub");
    expect(valid.emailVerified).toBe(true);

    verifyIdTokenMock.mockResolvedValueOnce({
      getPayload: () => ({
        email: "missing-sub@example.com",
      }),
    });

    await expect(service.verifyGoogleIdToken("id-token-2")).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe("geminiService", () => {
  it("should throw when gemini key is missing", async () => {
    clearEnvKeys(GEMINI_KEYS);
    jest.resetModules();

    const service = await import("../src/services/geminiService.js");
    await expect(service.createEmbedding("hello")).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("should generate chat reply and embeddings from gemini", async () => {
    clearEnvKeys(GEMINI_KEYS);
    process.env.GEMINI_API_KEY = "gemini-key";

    jest.resetModules();
    const service = await import("../src/services/geminiService.js");

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          payload: {
            candidates: [
              {
                content: {
                  parts: [{ text: "Gemini says hi" }],
                },
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          payload: {
            embedding: {
              values: [0.12, 0.34, 0.56],
            },
          },
        })
      );

    const text = await service.generateChatReply({
      user: { name: "User", tier: "Free" },
      mode: "Lovely",
      inputText: "hello there",
      history: [{ role: "user", text: "history 1" }],
      memoryContext: [],
    });
    expect(text).toBe("Gemini says hi");

    const embedding = await service.createEmbedding("embed this");
    expect(embedding).toEqual([0.12, 0.34, 0.56]);
  });

  it("should fail when gemini response is empty or errors", async () => {
    clearEnvKeys(GEMINI_KEYS);
    process.env.GEMINI_API_KEY = "gemini-key";

    jest.resetModules();
    const service = await import("../src/services/geminiService.js");

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          payload: {
            candidates: [{ content: { parts: [] } }],
          },
        })
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          ok: false,
          payload: { error: { message: "Gemini bad response" } },
        })
      )
      .mockRejectedValueOnce(new Error("network down"));

    await expect(
      service.generateChatReply({
        user: { name: "Neo", tier: "Free" },
        mode: "Lovely",
        inputText: "test 1",
        history: [],
        memoryContext: [],
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      details: { code: "AI_RESPONSE_UNAVAILABLE" },
    });

    await expect(
      service.generateChatReply({
        user: { name: "Neo", tier: "Free" },
        mode: "Lovely",
        inputText: "test 2",
        history: [],
        memoryContext: [],
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      details: { code: "AI_RESPONSE_UNAVAILABLE" },
    });

    await expect(
      service.generateChatReply({
        user: { name: "Neo", tier: "Free" },
        mode: "Lovely",
        inputText: "test 3",
        history: [],
        memoryContext: [],
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      details: { code: "AI_RESPONSE_UNAVAILABLE" },
    });
  });

  it("should parse image response and include generated data uri", async () => {
    clearEnvKeys(GEMINI_KEYS);
    process.env.GEMINI_API_KEY = "gemini-key";

    jest.resetModules();
    const service = await import("../src/services/geminiService.js");
    global.fetch = jest.fn().mockResolvedValueOnce(
      makeJsonResponse({
        payload: {
          candidates: [
            {
              content: {
                parts: [
                  { text: "image ready" },
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: "abcd1234",
                    },
                  },
                ],
              },
            },
          ],
        },
      })
    );

    const image = await service.generateImageResponse({ prompt: "draw moon" });
    expect(image.text).toContain("image ready");
    expect(image.imageUrl).toBe("data:image/png;base64,abcd1234");
  });
});
