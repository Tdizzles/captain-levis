#!/usr/bin/env node
// Prints the STAFF_PASSWORD_HASH value for a password, without ever storing the password.
//   STAFF_PASSWORD='...' node scripts/hash-password.mjs      (preferred: nothing lands in shell history as an argument)
//   echo -n 'password' | node scripts/hash-password.mjs
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
let pw = process.env.STAFF_PASSWORD || ''
if (!pw && !process.stdin.isTTY) pw = (await new Promise((r) => { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)) })).replace(/\r?\n$/, '')
if (!pw) { console.error('usage: STAFF_PASSWORD=... node scripts/hash-password.mjs'); process.exit(2) }
if (pw.length < 8) { console.error('password must be at least 8 characters'); process.exit(2) }

// tsx registers TypeScript on the fly so we can reuse lib/staff.ts verbatim
const require = createRequire(import.meta.url)
const tsxApi = require.resolve('tsx/esm/api')
const { register } = await import(pathToFileURL(tsxApi).href)
register()
const { hashPassword } = await import(pathToFileURL(path.join(here, '..', 'lib', 'staff.ts')).href)
process.stdout.write(hashPassword(pw) + '\n')
