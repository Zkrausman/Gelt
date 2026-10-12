import { defineConfig } from "vitest/config";
// Avoid cross-file PowerShell/C# helper contention on Windows without relaxing operation deadlines.
export default defineConfig({ test: { fileParallelism: process.platform !== 'win32', testTimeout: process.platform === 'win32' ? 180000 : 5000, hookTimeout: 30000, include: ["worker/src/**/*.test.ts", "web/lib/**/*.test.ts"] } });
