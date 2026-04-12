import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { requireSession } from './auth';

/**
 * Safely extract user email from request session.
 * Returns null if auth is disabled or session is invalid.
 */
export function getEmailFromRequest(req: NextRequest): string | null {
  try {
    return requireSession(req)?.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Log a usage event.
 *
 * Always writes to stdout (Docker: docker logs / Cloud Run: Cloud Logging).
 * Also appends to LOG_FILE_PATH as JSON Lines when set (Docker volume only).
 *
 * Format: {"ts":"...","email":"...","action":"..."}
 */
export function logUsage(email: string | null, action: string): void {
  const entry = { ts: new Date().toISOString(), email, action };
  const line = JSON.stringify(entry);

  console.log(`[usage] ${line}`);

  const logPath = process.env.LOG_FILE_PATH;
  if (!logPath) return;

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line + '\n');
  } catch {
    // non-fatal — don't break the API if logging fails
  }
}
