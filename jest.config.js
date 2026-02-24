export default {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  collectCoverageFrom: ["src/**/*.js", "!src/server.js"],
  setupFiles: ["<rootDir>/tests/env.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
};
