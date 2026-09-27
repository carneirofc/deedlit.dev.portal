import { defineConfig } from "vitest/config";

// Unit tests for the security-critical pure functions. Most of these modules
// read `process.env` on every call, so tests stub it with `vi.stubEnv` and
// `unstubEnvs` puts it back after each one.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    unstubEnvs: true,
    restoreMocks: true,
    // next-auth imports `next/server` without an extension, which Node's ESM
    // resolver refuses; letting Vite transform it resolves the subpath.
    server: { deps: { inline: ["next-auth"] } }
  }
});
