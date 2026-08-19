/**
 * Server-side object-storage shim (local filesystem).
 *
 * Images live OUTSIDE /public so they are never served directly; they are only
 * reachable through an access-controlled route handler. Filenames are opaque
 * ids to prevent path traversal and filename collisions.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), "storage");
const UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");

// Only safe, relative, single-segment keys are allowed.
const KEY_RE = /^(uploads|pdfs)\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,5}$/;

export async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(path.join(STORAGE_DIR, "pdfs"), { recursive: true });
}

function assertSafeKey(key: string) {
  if (!KEY_RE.test(key)) {
    throw new Error("Invalid file key.");
  }
}

export function resolvePath(key: string): string {
  assertSafeKey(key);
  return path.join(STORAGE_DIR, key);
}

export async function saveUpload(
  bytes: Buffer,
  ext: string
): Promise<{ key: string; absPath: string }> {
  await ensureDirs();
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5) || "bin";
  const id = nanoid(16);
  const key = `uploads/${id}.${safeExt}`;
  const absPath = path.join(STORAGE_DIR, key);
  await fs.writeFile(absPath, bytes);
  return { key, absPath };
}

export async function savePdf(
  bytes: Buffer,
  prefix: string
): Promise<{ key: string; absPath: string }> {
  await ensureDirs();
  const id = `${prefix}-${nanoid(12)}`;
  const key = `pdfs/${id}.pdf`;
  const absPath = path.join(STORAGE_DIR, key);
  await fs.writeFile(absPath, bytes);
  return { key, absPath };
}

export async function readBytes(key: string): Promise<Buffer> {
  assertSafeKey(key);
  return fs.readFile(resolvePath(key));
}

export async function deleteFile(key: string): Promise<void> {
  try {
    assertSafeKey(key);
    await fs.unlink(resolvePath(key));
  } catch {
    /* ignore missing */
  }
}

export function extFromMime(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "bin";
}

export function mimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
