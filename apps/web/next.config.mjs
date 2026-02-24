import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@rug-concierge/shared"],
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
