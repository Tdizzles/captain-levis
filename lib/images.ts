// Photo validation and neutralization: magic bytes must match an allowed image type (and the declared
// type, if any), then the image is fully re-encoded by sharp (resize ≤1600px, metadata stripped), so a
// polyglot or malformed file never reaches storage as-is.
import { fileTypeFromBuffer } from 'file-type'
import { randomBytes } from 'node:crypto'
import sharp, { type OutputInfo } from 'sharp'

export const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedMime = (typeof ALLOWED_MIMES)[number]
export const MAX_DIMENSION = 1600

export interface ProcessedImage { buffer: Buffer; mime: AllowedMime; width: number; height: number; filename: string; ext: string }

export class ImageRejectedError extends Error {
  constructor(message: string, public reason: string) { super(message); this.name = 'ImageRejectedError' }
}

export async function processImage(input: Buffer, declaredMime?: string): Promise<ProcessedImage> {
  if (!input.length) throw new ImageRejectedError('The file is empty.', 'empty')
  const detected = await fileTypeFromBuffer(input)
  const mime = detected?.mime
  if (!mime || !(ALLOWED_MIMES as readonly string[]).includes(mime)) {
    throw new ImageRejectedError('Only JPEG, PNG or WebP photos are accepted.', 'not_an_image')
  }
  const declared = (declaredMime || '').toLowerCase().split(';')[0].trim()
  if (declared && declared !== 'application/octet-stream' && declared !== mime && !(declared === 'image/jpg' && mime === 'image/jpeg')) {
    throw new ImageRejectedError('The file type does not match its contents.', 'mime_mismatch')
  }
  let pipeline = sharp(input, { failOn: 'error', limitInputPixels: 60_000_000, animated: false })
    .rotate() // apply EXIF orientation before EXIF is dropped
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
  let outMime: AllowedMime
  let ext: string
  if (mime === 'image/jpeg') { pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true }); outMime = 'image/jpeg'; ext = 'jpg' }
  else { pipeline = pipeline.webp({ quality: 82 }); outMime = 'image/webp'; ext = 'webp' }
  let result: { data: Buffer; info: OutputInfo }
  try {
    result = await pipeline.toBuffer({ resolveWithObject: true })
  } catch {
    throw new ImageRejectedError('That image could not be read. Please try a different photo.', 'decode_failed')
  }
  return {
    buffer: result.data,
    mime: outMime,
    width: result.info.width,
    height: result.info.height,
    ext,
    filename: `${randomBytes(12).toString('hex')}.${ext}`,
  }
}
