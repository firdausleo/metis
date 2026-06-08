#!/usr/bin/env node
/**
 * inject-env.js
 * Reads CF Pages secrets (available as process.env during build)
 * and writes them to .env.production so Vite can pick them up.
 * Run before vite build.
 */
import { writeFileSync } from 'fs'

const vars = {
  VITE_SUPABASE_URL:      process.env.VITE_SUPABASE_URL      || process.env.SUPABASE_URL || '',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
}

const content = Object.entries(vars)
  .map(([k, v]) => `${k}=${v}`)
  .join('\n')

writeFileSync('.env.production', content)
console.log('✓ Injected env vars:', Object.keys(vars).join(', '))
