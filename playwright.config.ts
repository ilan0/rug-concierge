import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 20_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "https://jjrugs-customer.vercel.app",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
