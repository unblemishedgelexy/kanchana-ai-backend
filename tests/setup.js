import { afterEach, beforeEach, jest } from "@jest/globals";
import { memoryStore } from "../src/data/memoryStore.js";
import { resetRateLimitStore } from "../src/middleware/rateLimit.js";

let consoleErrorSpy;

beforeEach(() => {
  memoryStore.nextId = 1;
  memoryStore.users = [];
  memoryStore.messages = [];
  memoryStore.resetTokens = [];
  memoryStore.payments = [];

  resetRateLimitStore();
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy?.mockRestore();
});
