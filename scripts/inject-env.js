#!/usr/bin/env node
/**
 * inject-env.js
 * Writes VITE_ env vars to .env.production before vite build.
 * Anon key is safe to include — it is a public key by design.
 * Supabase RLS policies protect the data, not this key.
 */
import { writeFileSync } from 'fs'

const SUPABASE_URL      = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndteGhjd2VsbHF0YWdwbmRweWhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzgxMzEsImV4cCI6MjA5NjQxNDEzMX0.drQigRpHx0vtR1rRo7ri7mE_kzwTYvVT04sKsd1nC7s'

const content = `VITE_SUPABASE_URL=${SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
`

writeFileSync('.env.production', content)
console.log('✓ env vars injected for build')
