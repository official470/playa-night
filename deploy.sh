#!/bin/bash
# 한 번에 올리기: 바뀐 파일 저장(커밋) → GitHub로 올리기 → GitHub Pages 반영까지 기다리기
# 사용법: ./deploy.sh "무엇을 바꿨는지"
set -e
cd "$(dirname "$0")"
MSG="${1:-update}"
REPO="official470/playa-night"
SITE="https://official470.github.io/playa-night/"

git add -A -- . ':!.claude'
if ! git diff --cached --quiet; then
  git commit -q -m "$MSG"
  echo "저장했어요: $MSG"
fi
if [ -z "$(git log origin/main..HEAD --oneline 2>/dev/null)" ]; then
  echo "올릴 새 변경이 없어요. 사이트: $SITE"
  exit 0
fi
# 관리자 페이지가 schedule.json을 GitHub에 직접 저장하므로, 그 변경을 먼저 받아온 뒤 올려요
git pull -q --rebase origin main
git push -q origin main
echo "GitHub에 올렸어요. 사이트 반영을 기다리는 중..."
SHA=$(git rev-parse HEAD)
for i in $(seq 1 60); do
  ST=$(gh api "repos/$REPO/pages/builds/latest" --jq '.status+" "+.commit' 2>/dev/null || true)
  if [ "$ST" = "built $SHA" ]; then echo "반영 완료: $SITE"; exit 0; fi
  case "$ST" in errored*) echo "사이트 빌드 오류: $ST"; exit 1;; esac
  sleep 5
done
echo "아직 반영 중이에요. 잠시 뒤 확인해 주세요: $SITE"
