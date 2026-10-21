import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, Jar, makeJpeg, postMultipart, startServer, type TestServer } from './helpers.js'

let srv: TestServer
beforeAll(async () => { srv = await startServer() })
afterAll(async () => { await srv.close() })

const up = (jar: Jar, files: { filename: string; type: string; data: Buffer }[]) =>
  postMultipart(`${srv.url}/api/uploads`, { sessionId: 'whatever' }, files.map((f) => ({ field: 'photos', ...f })), { jar })

describe('POST /api/uploads', () => {
  it('rejects an .exe renamed .jpg (magic bytes)', async () => {
    const jar = new Jar()
    const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00', 'binary'), Buffer.alloc(2048)])
    const r = await up(jar, [{ filename: 'totally-a-photo.jpg', type: 'image/jpeg', data: exe }])
    expect(r.status).toBe(400)
    expect(r.json.error).toMatch(/JPEG, PNG or WebP/)
  })

  it('rejects an 11 MB file', async () => {
    const jar = new Jar()
    const big = Buffer.concat([await makeJpeg(64, 64), Buffer.alloc(11 * 1024 * 1024, 0)])
    const r = await up(jar, [{ filename: 'huge.jpg', type: 'image/jpeg', data: big }])
    expect(r.status).toBe(413)
    expect(r.json.error).toMatch(/larger than 10 MB/)
  })

  it('stores up to 5 per session, rejects the 6th, strips metadata and caps the long side at 1600', async () => {
    const jar = new Jar()
    const withExif = await makeJpeg(2400, 1800, true)
    expect((await sharp(withExif).metadata()).exif).toBeTruthy()
    const first = await up(jar, [{ filename: 'big.jpg', type: 'image/jpeg', data: withExif }])
    expect(first.status).toBe(200)
    expect(first.json.ok).toBe(true)
    expect(first.json.files).toHaveLength(1)
    expect(first.json.files[0].width).toBe(1600)
    expect(first.json.files[0].height).toBe(1200)
    expect(jar.cookies.has('cl_session')).toBe(true)

    const d = await db()
    const stored = (await d.query<{ bytes: Uint8Array; width: number; height: number; filename: string }>('SELECT bytes, width, height, filename FROM photos WHERE id = $1', [first.json.files[0].id])).rows[0]
    const meta = await sharp(Buffer.from(stored.bytes)).metadata()
    expect(meta.width).toBe(1600)
    expect(meta.exif).toBeUndefined()
    expect(stored.filename).toMatch(/^[0-9a-f]{24}\.jpg$/)

    const small = await makeJpeg(320, 240)
    const four = await up(jar, [2, 3, 4, 5].map((i) => ({ filename: `p${i}.jpg`, type: 'image/jpeg', data: small })))
    expect(four.status).toBe(200)
    expect(four.json.files).toHaveLength(4)
    const sixth = await up(jar, [{ filename: 'p6.jpg', type: 'image/jpeg', data: small }])
    expect(sixth.status).toBe(400)
    expect(sixth.json.error).toMatch(/already has 5 photos/)
  })

  it('keeps the first 5 files of a 6-file request and reports the 6th', async () => {
    const jar = new Jar()
    const small = await makeJpeg(100, 100)
    const r = await up(jar, [1, 2, 3, 4, 5, 6].map((i) => ({ filename: `p${i}.jpg`, type: 'image/jpeg', data: small })))
    expect(r.status).toBe(200)
    expect(r.json.files).toHaveLength(5)
    expect(r.json.warnings?.join(' ')).toMatch(/maximum 5 photos/)
  })

  it('rejects a declared type that does not match the bytes', async () => {
    const jar = new Jar()
    const png = await sharp({ create: { width: 50, height: 50, channels: 4, background: '#5ECDFA' } }).png().toBuffer()
    const r = await up(jar, [{ filename: 'x.jpg', type: 'image/jpeg', data: png }])
    expect(r.status).toBe(400)
    expect(r.json.error).toMatch(/does not match/)
  })
})
