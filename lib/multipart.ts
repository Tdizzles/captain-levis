// Multipart parsing with busboy and hard limits. Works on a live request stream (dev server, Vercel —
// which restores the stream after buffering it) and on a pre-buffered body.
import Busboy from 'busboy'
import { Buffer } from 'node:buffer'
import { env } from './env.js'
import { contentType, header, HttpError, type Req } from './http.js'

export interface UploadedFile { field: string; filename: string; mime: string; buffer: Buffer }
export interface MultipartResult {
  fields: Record<string, string>
  files: UploadedFile[]
  rejected: { filename: string; reason: 'file_too_large' | 'too_many_files' | 'total_too_large' }[]
}

export interface MultipartLimits { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number; maxFields?: number; maxFieldBytes?: number }

export function parseMultipart(req: Req, limits: MultipartLimits = {}): Promise<MultipartResult> {
  const maxFiles = limits.maxFiles ?? env.maxPhotos
  const maxFileBytes = limits.maxFileBytes ?? env.maxPhotoBytes
  const maxTotalBytes = limits.maxTotalBytes ?? env.maxRequestBytes
  const maxFields = limits.maxFields ?? 40
  const maxFieldBytes = limits.maxFieldBytes ?? 16 * 1024

  if (contentType(req) !== 'multipart/form-data') return Promise.reject(new HttpError(400, 'Expected multipart/form-data.'))
  const declared = Number(header(req, 'content-length'))
  if (Number.isFinite(declared) && declared > maxTotalBytes + 64 * 1024) return Promise.reject(new HttpError(413, 'Those photos are too large. Please remove some and try again.'))

  return new Promise((resolve, reject) => {
    const out: MultipartResult = { fields: {}, files: [], rejected: [] }
    let total = 0
    let settled = false
    let bb: Busboy.Busboy
    try {
      bb = Busboy({ headers: req.headers as Record<string, string>, limits: { files: maxFiles + 1, fileSize: maxFileBytes, fields: maxFields, fieldSize: maxFieldBytes, parts: maxFiles + maxFields + 2 } })
    } catch (e) {
      reject(new HttpError(400, 'Malformed multipart body.'))
      return
    }
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      if (err) reject(err); else resolve(out)
    }
    bb.on('field', (name, value) => { out.fields[name] = typeof value === 'string' ? value : String(value) })
    bb.on('file', (field, stream, info) => {
      const filename = (info.filename || 'upload').slice(0, 200)
      const mime = (info.mimeType || '').toLowerCase()
      if (out.files.length >= maxFiles) {
        out.rejected.push({ filename, reason: 'too_many_files' })
        stream.resume()
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      let dropped = false
      stream.on('data', (c: Buffer) => {
        if (dropped) return
        size += c.length; total += c.length
        if (total > maxTotalBytes) { dropped = true; out.rejected.push({ filename, reason: 'total_too_large' }); chunks.length = 0; return }
        chunks.push(c)
      })
      stream.on('limit', () => { if (!dropped) { dropped = true; out.rejected.push({ filename, reason: 'file_too_large' }); chunks.length = 0 } })
      stream.on('end', () => { if (!dropped && size > 0) out.files.push({ field, filename, mime, buffer: Buffer.concat(chunks) }) })
    })
    bb.on('filesLimit', () => { /* extra files were counted in the 'file' handler */ })
    bb.on('error', (e: Error) => finish(new HttpError(400, 'Malformed multipart body: ' + e.message)))
    bb.on('close', () => finish())
    bb.on('finish', () => finish())
    if (Buffer.isBuffer(req.body)) { bb.end(req.body); return }
    req.on('error', (e: Error) => finish(new HttpError(400, 'Upload interrupted: ' + e.message)))
    req.pipe(bb)
  })
}
