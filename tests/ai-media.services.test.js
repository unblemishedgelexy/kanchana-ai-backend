import { describe, it, expect, jest } from "@jest/globals";

const IMAGEKIT_KEYS = [
  "IMAGEKIT_PUBLIC_KEY",
  "IMAGEKIT_PRIVATE_KEY",
  "IMAGEKIT_URL_ENDPOINT",
];

const GEMINI_KEYS = ["GEMINI_API_KEY", "GEMINI_CHAT_MODEL", "GEMINI_IMAGE_MODEL", "GEMINI_EMBED_MODEL"];
const GROQ_KEYS = [
  "GROQ_API_KEY",
  "GROQ_CHAT_MODEL",
  "GROQ_API_BASE_URL",
  "FREE_CHAT_PROVIDER_ORDER",
];
const GOOGLE_KEYS = ["GOOGLE_CLIENT_ID"];
const EXTERNAL_KEYS = ["APP_API_KEY", "APP_CLIENT_SECRET", "KANCHANA_API_BASE_URL"];

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

describe("groqService", () => {
  it("should throw when groq key is missing", async () => {
    clearEnvKeys(GROQ_KEYS);
    jest.resetModules();

    const service = await import("../src/services/groqService.js");
    await expect(
      service.generateGroqReply({
        user: { name: "Test", tier: "Free" },
        mode: "Lovely",
        inputText: "hello",
        history: [],
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      details: {
        provider: "groq",
      },
    });
  });

  it("should generate reply from groq with system prompt and history", async () => {
    clearEnvKeys(GROQ_KEYS);
    process.env.GROQ_API_KEY = "groq-key";
    process.env.GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.GROQ_CHAT_MODEL = "llama-3.1-8b-instant";

    jest.resetModules();
    const service = await import("../src/services/groqService.js");

    global.fetch = jest.fn().mockResolvedValue(
      makeJsonResponse({
        payload: {
          choices: [
            {
              message: {
                content: "Groq says hello",
              },
            },
          ],
        },
      })
    );

    const text = await service.generateGroqReply({
      user: { name: "Neo", tier: "Free" },
      mode: "Shayari",
      inputText: "ek line sunao",
      history: [
        { role: "user", text: "pichli line" },
        { role: "kanchana", text: "pichla jawab" },
      ],
    });

    expect(text).toBe("Groq says hello");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledOptions] = global.fetch.mock.calls[0];
    expect(calledUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(calledOptions.body);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Active mode: Shayari");
    expect(body.messages[1]).toEqual({ role: "user", content: "pichli line" });
    expect(body.messages[2]).toEqual({ role: "assistant", content: "pichla jawab" });
    expect(body.messages[3]).toEqual({ role: "user", content: "ek line sunao" });
  });
});

describe("freeChatService", () => {
  it("should fallback to kanchana external when groq fails", async () => {
    clearEnvKeys([...GROQ_KEYS, ...EXTERNAL_KEYS]);
    process.env.GROQ_API_KEY = "groq-key";
    process.env.GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.FREE_CHAT_PROVIDER_ORDER = "groq,kanchana_external";
    process.env.APP_API_KEY = "app-key";
    process.env.APP_CLIENT_SECRET = "client-secret";
    process.env.KANCHANA_API_BASE_URL = "https://ai.example.com";

    jest.resetModules();
    const service = await import("../src/services/freeChatService.js");

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "Rate limit" } }),
      })
      .mockResolvedValueOnce(
        makeJsonResponse({
          payload: {
            reply: "External fallback reply",
          },
        })
      );

    const reply = await service.generateFreeTierReply({
      user: { name: "Neo", tier: "Free" },
      mode: "Lovely",
      inputText: "hello",
      history: [{ role: "user", text: "older chat" }],
    });

    expect(reply).toEqual({
      text: "External fallback reply",
      provider: "kanchana_external",
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const [, externalOptions] = global.fetch.mock.calls[1];
    const externalBody = JSON.parse(externalOptions.body);
    expect(externalBody.systemPrompt).toContain("Active mode:");
    expect(externalBody.history).toEqual([{ role: "user", content: "older chat" }]);
  });
});

describe("kanchanaExternalService", () => {
  it("should send history using content field for ai-model compatibility", async () => {
    clearEnvKeys(EXTERNAL_KEYS);
    process.env.APP_API_KEY = "app-key";
    process.env.APP_CLIENT_SECRET = "client-secret";
    process.env.KANCHANA_API_BASE_URL = "https://ai.example.com";

    jest.resetModules();
    const service = await import("../src/services/kanchanaExternalService.js");

    const fetchMock = jest.fn().mockResolvedValue(
      makeJsonResponse({
        payload: {
          reply: "ok reply",
        },
      })
    );
    global.fetch = fetchMock;

    const reply = await service.generateExternalFreeReply({
      message: "hello",
      history: [
        { role: "user", text: "user turn one" },
        { role: "kanchana", text: "assistant turn one" },
      ],
      context: {
        mode: "Lovely",
      },
    });

    expect(reply).toBe("ok reply");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://ai.example.com/v1/chat");

    const body = JSON.parse(calledOptions.body);
    expect(body.history).toEqual([
      { role: "user", content: "user turn one" },
      { role: "assistant", content: "assistant turn one" },
    ]);
  });
});
