/**
 * Image quality heuristics + optimization (server-only, sharp-based).
 *
 * Quality checks WARN rather than block, per the product requirements.
 */
import sharp from "sharp";

export type ImageAnalysis = {
  ok: boolean;
  errorReason?: string;
  format?: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  qualityFlags: string[];
  optimizedBuffer: Buffer;
  optimizedMime: string;
};

const MAX_DIMENSION = 2000;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 300;

function detectMime(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return "image/webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return null;
}

export async function analyzeAndOptimize(
  bytes: Buffer,
  declaredMime?: string
): Promise<ImageAnalysis> {
  const sizeBytes = bytes.byteLength;
  const qualityFlags: string[] = [];

  const mime = detectMime(bytes) || declaredMime || "";
  if (!mime || !mime.startsWith("image/")) {
    return {
      ok: false,
      errorReason:
        "This file does not look like a supported image. Please use a JPG or PNG photo of the page.",
      sizeBytes,
      qualityFlags: ["unsupported_format"],
      optimizedBuffer: Buffer.alloc(0),
      optimizedMime: "image/jpeg",
    };
  }

  let width = 0;
  let height = 0;
  let format: string | undefined;
  let optimizedBuffer: Buffer;
  try {
    // honor EXIF orientation
    const meta = await sharp(bytes, { failOn: "truncated" }).rotate().metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    format = meta.format;

    optimizedBuffer = await sharp(bytes, { failOn: "truncated" })
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: false })
      .toBuffer();
  } catch {
    return {
      ok: false,
      errorReason:
        "We could not read this image. It may be damaged. Please retake the photo.",
      sizeBytes,
      qualityFlags: ["invalid_image"],
      optimizedBuffer: Buffer.alloc(0),
      optimizedMime: "image/jpeg",
    };
  }

  if (width && height && (width < MIN_WIDTH || height < MIN_HEIGHT)) {
    qualityFlags.push("too_small");
  }
  if (width && height && Math.max(width, height) / Math.min(width, height) > 3) {
    qualityFlags.push("extreme_aspect");
  }

  // Lightweight blur heuristic: low standard deviation on a small grayscale.
  try {
    const stats = await sharp(bytes)
      .resize(160, 160, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
    const n = stats.length;
    if (n > 0) {
      const mean = stats.reduce((a, b) => a + b, 0) / n;
      const variance =
        stats.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
      const std = Math.sqrt(variance);
      // Very flat luminance often signals blur or an empty/blank shot.
      if (std < 22) qualityFlags.push("blur_warning");
      if (std > 118) qualityFlags.push("glare_warning");
    }
  } catch {
    /* heuristic only */
  }

  return {
    ok: true,
    format: format ?? mime,
    width,
    height,
    sizeBytes,
    qualityFlags,
    optimizedBuffer,
    optimizedMime: "image/jpeg",
  };
}

export const QUALITY_LABELS: Record<string, string> = {
  unsupported_format: "Unsupported image format",
  invalid_image: "Image could not be read",
  too_small: "Image is very small",
  extreme_aspect: "Unusual page shape",
  blur_warning: "Photo may be blurry. Retaking is recommended.",
  glare_warning: "Possible glare on the page.",
};
