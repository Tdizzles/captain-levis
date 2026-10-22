#!/usr/bin/env bash
# One-shot Vercel configuration for the captain-levis project (handover §4a as a script).
# Run from Git Bash on the machine that is logged in as `tdizzles`:
#
#   bash scripts/vercel-setup.sh            # secrets + git connect + domains + redeploy + health check
#   bash scripts/vercel-setup.sh --no-deploy
#
# Owner keys can be passed as env vars whenever they arrive; each one is added only if set and not already present:
#
#   TURNSTILE_SECRET_KEY=... RESEND_API_KEY=... ANTHROPIC_API_KEY=... bash scripts/vercel-setup.sh
#
# Safe to re-run: existing variables are never overwritten, git connect / domains add are skipped when already done.
# DATABASE_URL is NOT created here (Vercel dashboard → Storage → Create → Neon → connect to captain-levis).
# If it exists when this runs, migrations are applied to it.
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY=1
for a in "$@"; do case "$a" in --no-deploy) DEPLOY=0 ;; *) echo "unknown arg $a" >&2; exit 2 ;; esac; done

V="npx vercel"
log() { printf '\n== %s\n' "$*"; }

log "Checking login + project link"
$V whoami
[ -f .vercel/project.json ] || { echo "Project not linked: run 'npx vercel link' (team tdizzles-projects, project captain-levis)" >&2; exit 1; }
grep -q prj_a3q1YKeo5FfTW8OE1IxJi0IOviW3 .vercel/project.json || echo "WARN: .vercel/project.json is not the captain-levis project id" >&2

ENV_LIST="$($V env ls 2>/dev/null || true)"
has_env() { printf '%s\n' "$ENV_LIST" | grep -qE "^[[:space:]]*$1[[:space:]]"; }

# add_env NAME ENVIRONMENT VALUE  — sensitive, skipped when NAME already exists in any environment
add_env() {
  local name="$1" target="$2" value="$3"
  if has_env "$name"; then echo "   $name already set, leaving it alone"; return 0; fi
  printf '%s' "$value" | $V env add "$name" "$target" --sensitive
  echo "   added $name ($target)"
}

log "1. Secrets we mint ourselves"
if has_env SESSION_SECRET; then
  echo "   SESSION_SECRET already set"
else
  printf '%s' "$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")" | $V env add SESSION_SECRET production --sensitive
  printf '%s' "$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")" | $V env add SESSION_SECRET preview --sensitive
  echo "   added SESSION_SECRET (production + preview, different values)"
fi
if has_env ADMIN_API_TOKEN; then
  echo "   ADMIN_API_TOKEN already set"
else
  TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))")"
  printf '%s' "$TOKEN" | $V env add ADMIN_API_TOKEN production --sensitive
  mkdir -p .vercel && printf 'ADMIN_API_TOKEN=%s\n' "$TOKEN" > .vercel/admin-token.local
  echo "   added ADMIN_API_TOKEN; copy kept in .vercel/admin-token.local (gitignored) — the estimater needs it"
fi
ENV_LIST="$($V env ls 2>/dev/null || true)"

log "2. Owner-supplied keys (only those passed in the environment)"
[ -n "${TURNSTILE_SECRET_KEY:-}" ] && add_env TURNSTILE_SECRET_KEY production "$TURNSTILE_SECRET_KEY" \
  && echo "   remember: put the matching SITE key in site/business.json (turnstileSiteKey), run node scripts/build.mjs, commit"
[ -n "${RESEND_API_KEY:-}" ] && add_env RESEND_API_KEY production "$RESEND_API_KEY" \
  && echo "   remember: SPF/DKIM for inquiries@captainlevis.com in the Resend dashboard"
[ -n "${ANTHROPIC_API_KEY:-}" ] && add_env ANTHROPIC_API_KEY production "$ANTHROPIC_API_KEY"
ENV_LIST="$($V env ls 2>/dev/null || true)"
has_env TURNSTILE_SECRET_KEY || echo "   TURNSTILE_SECRET_KEY not set yet → /api/inquiries keeps answering 503 'call us' in production"
has_env RESEND_API_KEY || echo "   RESEND_API_KEY not set yet → inquiries are stored, emails wait as pending_config"
has_env ANTHROPIC_API_KEY || echo "   ANTHROPIC_API_KEY not set yet → chat runs in scripted mode"

log "3. Database"
if has_env DATABASE_URL; then
  echo "   DATABASE_URL present → pulling it and running migrations"
  $V env pull .env.vercel --environment production --yes >/dev/null
  DBURL="$(grep -E '^DATABASE_URL=' .env.vercel | cut -d= -f2- | tr -d '"')"
  DATABASE_URL="$DBURL" npm run migrate
else
  echo "   DATABASE_URL missing. Create it in the dashboard: Storage → Create Database → Neon (free) → connect to captain-levis."
  echo "   Then re-run this script; it will migrate. (Handlers also auto-migrate on cold start with AUTO_MIGRATE unset.)"
fi

log "4. Git connect (auto-deploy from GitHub Tdizzles/captain-levis)"
# `project inspect` does not print the Git link, so ask git connect itself; "already connected" is success.
OUT="$($V git connect https://github.com/Tdizzles/captain-levis.git --yes 2>&1 || true)"
printf '%s
' "$OUT" | grep -v '^Vercel CLI'
printf '%s' "$OUT" | grep -qiE 'already connected|Connected GitHub' || echo "   git connect failed — do it in the dashboard: Settings → Git → Connect"

log "5. Domains (harmless before DNS moves; prints the records the registrar needs)"
for d in captainlevis.com www.captainlevis.com; do
  if $V domains inspect "$d" >/dev/null 2>&1; then echo "   $d already on the account"; else $V domains add "$d" captain-levis || echo "   $d: add failed (see above)"; fi
done

if [ "$DEPLOY" = 1 ]; then
  log "6. Redeploy production so the new env vars take effect"
  $V --prod --yes
fi

log "7. Health"
curl -s https://captain-levis.vercel.app/api/health; echo
echo "Expect configured.session_secret:true and admin_token:true now; database:true once Neon is connected."
echo "DNS is NOT changed by this script. When ready to launch, at the registrar (Network Solutions / worldnic) set:"
echo "   A     @    64.29.17.1          CNAME  www  cname.vercel-dns.com."
echo "then: npx vercel domains verify captainlevis.com"
