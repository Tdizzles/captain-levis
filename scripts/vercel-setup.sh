#!/usr/bin/env bash
# One-shot Vercel configuration for the captain-levis project (handover §4a as a script).
# Run from Git Bash on the machine that is logged in as `tdizzles`:
#
#   bash scripts/vercel-setup.sh            # secrets + git connect + domains + redeploy (of the live commit) + health
#   bash scripts/vercel-setup.sh --no-deploy
#
# Owner keys can be passed as env vars whenever they arrive. A key you pass REPLACES the one on Vercel (that is how
# you rotate it); keys you don't pass are left alone:
#
#   TURNSTILE_SECRET_KEY=... RESEND_API_KEY=... ANTHROPIC_API_KEY=... bash scripts/vercel-setup.sh
#   STAFF_PASSWORD='...' bash scripts/vercel-setup.sh      # Quote Desk sign-in: hashed here, only the hash goes to Vercel
#   EMAIL_TO='captainlevis@yahoo.com,you@example.com' bash scripts/vercel-setup.sh   # who gets the quote emails
#
# RESEND_API_KEY also runs scripts/resend-domain.mjs --apply (sending domain + Vercel DNS records + verification).
#
# Safe to re-run: minted secrets are never overwritten, git connect / domains add are skipped when already done.
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

# set_env NAME ENVIRONMENT VALUE [plain] — the owner passed this value on purpose, so it replaces what is there
# (sensitive unless the 4th arg is "plain"; Vercel can't edit a sensitive value in place, so rm + add)
set_env() {
  local name="$1" target="$2" value="$3" flag="--sensitive"
  [ "${4:-}" = plain ] && flag=""
  if has_env "$name"; then
    $V env rm "$name" "$target" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | $V env add "$name" "$target" $flag >/dev/null
    echo "   replaced $name ($target)"
  else
    printf '%s' "$value" | $V env add "$name" "$target" $flag >/dev/null
    echo "   added $name ($target)"
  fi
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
if [ -n "${TURNSTILE_SECRET_KEY:-}" ]; then
  set_env TURNSTILE_SECRET_KEY production "$TURNSTILE_SECRET_KEY"
  echo "   remember: put the matching SITE key in site/business.json (turnstileSiteKey), run node scripts/build.mjs, commit"
fi
if [ -n "${RESEND_API_KEY:-}" ]; then
  echo "   Resend sending domain first (adds the SPF/DKIM/DMARC records to Vercel DNS and waits for verification):"
  RESEND_API_KEY="$RESEND_API_KEY" node scripts/resend-domain.mjs --apply \
    || echo "   domain not verified yet: re-run 'RESEND_API_KEY=... node scripts/resend-domain.mjs --apply' in a few minutes"
  set_env RESEND_API_KEY production "$RESEND_API_KEY"
fi
[ -n "${ANTHROPIC_API_KEY:-}" ] && set_env ANTHROPIC_API_KEY production "$ANTHROPIC_API_KEY"
[ -n "${EMAIL_TO:-}" ] && set_env EMAIL_TO production "$EMAIL_TO" plain
if [ -n "${STAFF_PASSWORD:-}" ]; then
  HASH="$(STAFF_PASSWORD="$STAFF_PASSWORD" node scripts/hash-password.mjs)"
  if has_env STAFF_PASSWORD_HASH; then
    echo "   STAFF_PASSWORD_HASH already set → replacing it with the new password"
    $V env rm STAFF_PASSWORD_HASH production --yes >/dev/null 2>&1 || true
  fi
  printf '%s' "$HASH" | $V env add STAFF_PASSWORD_HASH production --sensitive
  echo "   set STAFF_PASSWORD_HASH (Quote Desk sign-in at /app for ${STAFF_EMAILS:-the two owner emails})"
  if [ -n "${STAFF_EMAILS:-}" ] && ! has_env STAFF_EMAILS; then printf '%s' "$STAFF_EMAILS" | $V env add STAFF_EMAILS production; fi
fi
ENV_LIST="$($V env ls 2>/dev/null || true)"
has_env TURNSTILE_SECRET_KEY || echo "   TURNSTILE_SECRET_KEY not set yet → /api/inquiries keeps answering 503 'call us' in production"
has_env RESEND_API_KEY || echo "   RESEND_API_KEY not set yet → inquiries are stored, emails wait as pending_config"
has_env ANTHROPIC_API_KEY || echo "   ANTHROPIC_API_KEY not set yet → chat runs in scripted mode"
has_env STAFF_PASSWORD_HASH || echo "   STAFF_PASSWORD_HASH not set yet → Quote Desk (/app) sign-in disabled; run with STAFF_PASSWORD='...'"

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

log "5. Domains, checked against the PROJECT ('domains inspect' only checks the account, which hid a missing www)"
PROJECT_ID=prj_a3q1YKeo5FfTW8OE1IxJi0IOviW3
TEAM_ID=team_iYFz6LJgsbrPkRbTuIBDnaLE
DOMAIN_MISSING=0
project_domain() { MSYS_NO_PATHCONV=1 $V api "/v9/projects/$PROJECT_ID/domains/$1?teamId=$TEAM_ID" 2>/dev/null || true; }
# the apex serves the site (canonical https://captainlevis.com); www 308-redirects to it
for d in captainlevis.com www.captainlevis.com; do
  J="$(project_domain "$d")"
  if ! printf '%s' "$J" | grep -q "\"name\":\"$d\""; then
    echo "   $d is NOT attached to the project; adding it"
    $V domains add "$d" captain-levis || true
    J="$(project_domain "$d")"
  fi
  if printf '%s' "$J" | grep -q "\"name\":\"$d\""; then
    R="$(printf '%s' "$J" | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write((j.redirect?'redirects to '+j.redirect+' ('+(j.redirectStatusCode||'')+')':'serves the site')+(j.verified===false?', NOT verified':''))}catch{process.stdout.write('?')}})")"
    echo "   $d attached: $R"
  else
    echo "   $d still missing: add it in the dashboard (Settings, Domains)"; DOMAIN_MISSING=1
  fi
done

if [ "$DEPLOY" = 1 ]; then
  log "6. Redeploy production so the new env vars take effect"
  # Rebuild what production already runs (the pushed commit). Never '$V --prod' here: that uploads this working
  # tree, and parallel sessions keep unfinished edits in it.
  PROD_URL="$(MSYS_NO_PATHCONV=1 $V api "/v6/deployments?projectId=$PROJECT_ID&teamId=$TEAM_ID&target=production&state=READY&limit=1" 2>/dev/null \
    | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{try{process.stdout.write(JSON.parse(s).deployments[0].url)}catch{}})")"
  if [ -n "$PROD_URL" ]; then $V redeploy "$PROD_URL" --environment production; else echo "   could not find the production deployment; push any commit to redeploy"; fi
fi

log "7. Health (the alias can lag the deploy by ~20 s, so retry a few times)"
for i in 1 2 3 4 5 6; do
  H="$(curl -s https://captainlevis.com/api/health)"
  printf '%s
' "$H" | grep -q '"ok":true' && break
  [ "$i" = 6 ] || sleep 10
done
printf '%s
' "$H"
echo "Expect ok:true and missing:[]; version should equal the commit you just pushed or deployed."
echo "DNS lives on Vercel's nameservers (ns1/ns2.vercel-dns.com) since 2026-11-04: change records with 'npx vercel dns' or the dashboard."
[ "$DOMAIN_MISSING" = 0 ] || { echo "A domain is not attached to the project (see step 5)." >&2; exit 1; }
