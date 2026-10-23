// Static list of migrations so Vercel's file tracer bundles the .sql files with the functions.
// Add a line here for every new db/migrations/NNN_*.sql (test/migrations.test.ts checks the list is complete).
import { readFileSync } from 'node:fs'

const load = (name: string) => readFileSync(new URL(`./${name}.sql`, import.meta.url), 'utf8')

export const MIGRATIONS: { name: string; sql: string }[] = [
  { name: '001_init', sql: load('001_init') },
  { name: '002_estimates', sql: load('002_estimates') },
  { name: '003_inquiry_details', sql: load('003_inquiry_details') },
]
