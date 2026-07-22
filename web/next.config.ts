import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const localVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
const localServerUrl = process.env.NEXT_PUBLIC_SERVER_URL?.trim().replace(/\/+$/, "") || "http://127.0.0.1:8080";

export default function nextConfig(phase: string): NextConfig {
    const isDev = phase === PHASE_DEVELOPMENT_SERVER;

    return {
        output: "standalone",
        poweredByHeader: false,
        allowedDevOrigins: isDev ? ["*.*.*.*"] : [],
        typescript: {
            ignoreBuildErrors: true,
        },
        env: {
            NEXT_PUBLIC_APP_VERSION: localVersion,
        },
        async headers() {
            return [{
                source: "/:path*",
                headers: [
                    { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" },
                    { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
                    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "X-Frame-Options", value: "DENY" },
                ],
            }];
        },
        async rewrites() {
            if (!isDev) return [];

            return [{ source: "/api/v1/:path*", destination: `${localServerUrl}/api/v1/:path*` }];
        },
    };
}
