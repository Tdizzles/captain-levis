import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from './helpers.js'

// Vercel Hobby: "No more than 12 Serverless Functions can be added to a Deployment". One function per file in api/.
function apiFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return apiFiles(p)
    return /\.(ts|js|mjs)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [path.relative(ROOT, p)] : []
  })
}

describe('deployment function budget', () => {
  it('stays within the 12-function Hobby limit', () => {
    const files = apiFiles(path.join(ROOT, 'api'))
    expect(files.length, files.join('\n')).toBeLessThanOrEqual(12)
  })
})
