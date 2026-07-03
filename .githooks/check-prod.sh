#!/usr/bin/env bash
# Сверяет commit-sha текущего Production-деплоя на Vercel и Railway с
# локальным git HEAD после мержа в main. Ничего не деплоит и не меняет —
# только предупреждает, если прод разошёлся с git (см. HANDOFF.md →
# «Деплой-дисциплина» — эта проверка обязанность только локальной сессии).
#
# Токены НЕ хранятся в этом файле — читаются из локальных конфигов CLI
# (Vercel/Railway), которые уже существуют на машине после `vercel login`/
# `railway login`. Если файлов нет — скрипт просто предупреждает и выходит.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

# Проверяем только когда HEAD реально на main — post-merge хук вызывается
# при любом мерже, включая мерж feature-веток в другие ветки.
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  exit 0
fi

LOCAL_SHA="$(git rev-parse HEAD)"
LOCAL_SHORT="${LOCAL_SHA:0:7}"

echo ""
echo "🔍 Проверка прод ↔ main (локальный HEAD: $LOCAL_SHORT)"

# --- Vercel ---
VERCEL_AUTH="$USERPROFILE/AppData/Roaming/xdg.data/com.vercel.cli/auth.json"
VERCEL_PROJECT="$REPO_ROOT/.vercel/project.json"

if [ -f "$VERCEL_AUTH" ] && [ -f "$VERCEL_PROJECT" ]; then
  VERCEL_RESULT="$(node -e "
    const fs = require('fs');
    const https = require('https');
    const auth = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const project = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const url = 'https://api.vercel.com/v6/deployments?projectId=' + project.projectId +
      '&teamId=' + project.orgId + '&target=production&limit=1';
    https.get(url, { headers: { Authorization: 'Bearer ' + auth.token } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const dep = j.deployments && j.deployments[0];
          if (!dep) { console.log('NONE'); return; }
          console.log((dep.meta && dep.meta.githubCommitSha) || 'UNKNOWN');
        } catch (e) { console.log('ERROR'); }
      });
    }).on('error', () => console.log('ERROR'));
  " "$VERCEL_AUTH" "$VERCEL_PROJECT" 2>/dev/null)"

  # Даём запросу время (node http async) — простой синхронный wait не нужен,
  # т.к. process не завершится, пока не сработает callback.

  if [ "$VERCEL_RESULT" = "ERROR" ] || [ -z "$VERCEL_RESULT" ]; then
    echo "⚠️  Vercel: не удалось проверить (сеть/токен?)"
  elif [ "$VERCEL_RESULT" = "NONE" ]; then
    echo "⚠️  Vercel: production-деплоев не найдено"
  elif [ "${VERCEL_RESULT:0:7}" = "$LOCAL_SHORT" ]; then
    echo "✅ Vercel: прод синхронен ($LOCAL_SHORT)"
  else
    echo "🔴 VERCEL РАСХОДИТСЯ С MAIN"
    echo "   прод: ${VERCEL_RESULT:0:7}  |  main: $LOCAL_SHORT"
    echo "   → проверь, не было ли ручного 'vercel --prod' в обход git (см. HANDOFF.md → Деплой-дисциплина)"
  fi
else
  echo "ℹ️  Vercel: конфиг CLI не найден, пропуск (запусти 'vercel login' один раз)"
fi

# --- Railway ---
RAILWAY_CONFIG="$USERPROFILE/.railway/config.json"
if [ -f "$RAILWAY_CONFIG" ]; then
  RAILWAY_RESULT="$(node -e "
    const fs = require('fs');
    const https = require('https');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    // Ищем привязку reliable-flow среди зарегистрированных проектов CLI —
    // имя папки может отличаться, поэтому матчим по названию Railway-проекта.
    const entry = Object.values(cfg.projects || {}).find(p => p.name === 'reliable-flow');
    if (!entry) { console.log('NOLINK'); process.exit(0); }
    const token = cfg.user && cfg.user.accessToken;
    if (!token) { console.log('NOTOKEN'); process.exit(0); }
    const query = JSON.stringify({
      query: 'query(\$p: String!, \$s: String!) { deployments(input: { projectId: \$p, serviceId: \$s }, first: 5) { edges { node { status meta } } } }',
      variables: { p: entry.project, s: entry.service },
    });
    const req = https.request('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const edges = (j.data && j.data.deployments && j.data.deployments.edges) || [];
          const success = edges.find(e => e.node.status === 'SUCCESS');
          if (!success) { console.log('NONE'); return; }
          console.log(success.node.meta.commitHash || 'UNKNOWN');
        } catch (e) { console.log('ERROR'); }
      });
    });
    req.on('error', () => console.log('ERROR'));
    req.write(query);
    req.end();
  " "$RAILWAY_CONFIG" 2>/dev/null)"

  if [ "$RAILWAY_RESULT" = "NOLINK" ]; then
    echo "ℹ️  Railway: проект 'reliable-flow' не привязан в CLI, пропуск"
  elif [ "$RAILWAY_RESULT" = "NOTOKEN" ] || [ "$RAILWAY_RESULT" = "ERROR" ] || [ -z "$RAILWAY_RESULT" ]; then
    echo "⚠️  Railway: не удалось проверить (сеть/токен?)"
  elif [ "$RAILWAY_RESULT" = "NONE" ]; then
    echo "⚠️  Railway: успешных деплоев не найдено"
  elif [ "${RAILWAY_RESULT:0:7}" = "$LOCAL_SHORT" ]; then
    echo "✅ Railway: прод синхронен ($LOCAL_SHORT)"
  else
    echo "🔴 RAILWAY РАСХОДИТСЯ С MAIN"
    echo "   прод: ${RAILWAY_RESULT:0:7}  |  main: $LOCAL_SHORT"
    echo "   → проверь, не было ли ручного 'railway up' в обход git (см. HANDOFF.md → Деплой-дисциплина)"
  fi
else
  echo "ℹ️  Railway: конфиг CLI не найден, пропуск (запусти 'railway login' один раз)"
fi

echo ""
exit 0
