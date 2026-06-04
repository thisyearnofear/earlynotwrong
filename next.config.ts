import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The `privacycash` SDK depends on `node-localstorage` + `write-file-atomic`
   * (uses Node `fs`), which cannot run in the browser bundle. Keep it
   * server-only and access it via the `/api/privacy/balance` route.
   */
  serverExternalPackages: ["privacycash"],
};

export default nextConfig;
