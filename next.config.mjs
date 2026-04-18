/** @type {import('next').NextConfig} */
const nextConfig = {
  // Root URL lands users on the BetOnMe UI. Non-permanent (307) so we can
  // change our minds later without browser cache fighting us. The test
  // harness is still reachable at /debug.
  async redirects() {
    return [
      { source: "/", destination: "/app", permanent: false },
    ];
  },
  // The BetOnMe Vite app is built into public/app during `npm run build`.
  // These rewrites make react-router deep links (/app/bets, /app/sign-in,
  // etc.) serve the SPA shell (public/app/index.html). Static files in
  // public/ are matched by Next before rewrites, so /app/assets/* JS/CSS
  // keep working as-is.
  async rewrites() {
    return [
      { source: "/app", destination: "/app/index.html" },
      { source: "/app/:path*", destination: "/app/index.html" },
    ];
  },
};

export default nextConfig;
