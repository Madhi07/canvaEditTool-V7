/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // your existing permissive config — fine for dev, but tighten for prod!
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
    qualities: [25, 50, 75, 100],
  },

  // Add rewrites so you can fetch audio via /s3/:path* (same-origin)
  async rewrites() {
    return [
      // This maps /s3/<rest> -> your S3 bucket URL (Next will proxy)
      {
        source: "/s3/:path*",
        destination:
          "https://agentzee-media-agent.s3.ap-south-1.amazonaws.com/:path*",
      },
      // If you use CloudFront or another domain, add another rule:
      // {
      //   source: "/cdn/:path*",
      //   destination: "https://your-cloudfront-domain/:path*",
      // },
    ];
  },

  // Optional: add headers for responses served by Next (won't affect S3 direct responses)
  async headers() {
    return [
      {
        // Add CORS headers for the proxied path(s) that Next serves
        source: "/s3/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,HEAD,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
