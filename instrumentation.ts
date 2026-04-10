/**
 * instrumentation.ts — Next.js server startup hook
 *
 * Runs once when the Node.js server starts. Cleans up stale /tmp/video-export
 * directories left by containers that were killed before finally-block cleanup ran.
 *
 * Next.js 15+ supports this file natively.
 * Next.js <15: add `experimental: { instrumentationHook: true }` to next.config.ts.
 * Verify your version with: npm ls next
 */
export async function register() {
  // Only run on the server (not during edge runtime or client-side bundling)
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.VIDEO_EXPORT_ENABLED === 'true') {
    const { cleanupStaleTempFiles } = await import('@/lib/videoExport');
    await cleanupStaleTempFiles();
    console.log('[VideoExport] Startup /tmp cleanup completed');
  }
}
