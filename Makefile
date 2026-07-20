CODEX ?= codex
VERBOSE ?= 0

.PHONY: app-build build changelog check deps dist install major minor package patch release release-major release-minor release-patch run tag typecheck

deps: node_modules/.package-lock.stamp

node_modules/.package-lock.stamp: package.json package-lock.json
	npm install
	touch node_modules/.package-lock.stamp

install:
	npm install
	touch node_modules/.package-lock.stamp

app-build: deps
	npm run build:app

run: deps
	DISPLAY=:0 npm start -- --no-sandbox --profile split-screen

typecheck: deps
	npm run typecheck

check: deps typecheck app-build
	npm run lint
	npm test

changelog:
	@npm run build:scripts --silent
	@node build-scripts/scripts/update-changelog.js --agent --codex "$(CODEX)" --verbose "$(VERBOSE)"
	@git diff

build: check
	npm run package

package: build

dist: check
	npm run dist

release:
	@test -n "$(TYPE)" || (echo "TYPE is required. Use release-major, release-minor, or release-patch." >&2; exit 1)
	@branch="$$(git branch --show-current)"; \
	test -n "$$branch" || (echo "Cannot release from a detached HEAD." >&2; exit 1); \
	test "$$branch" = "main" || (echo "Releases must be created from main, not $$branch." >&2; exit 1); \
	dirty="$$(git status --porcelain | awk '{print $$2}' | grep -Ev '^(CHANGELOG.md|src/shared/changelog.json)$$' || true)"; \
	test -z "$$dirty" || (echo "Release has unrelated dirty files:" >&2; echo "$$dirty" >&2; exit 1); \
	version="$$(node -e "const p=require('./package.json'); const parts=p.version.split('.').map(Number); const t='$(TYPE)'; if(t==='major') console.log((parts[0]+1)+'.0.0'); else if(t==='minor') console.log(parts[0]+'.'+(parts[1]+1)+'.0'); else console.log(parts[0]+'.'+parts[1]+'.'+(parts[2]+1));")"; \
	npm run build:scripts --silent; \
	node build-scripts/scripts/update-changelog.js --release --version "$$version"; \
	npm version "$$version" --no-git-tag-version; \
	git add package.json package-lock.json CHANGELOG.md src/shared/changelog.json; \
	git commit -m "Release v$$version"; \
	git push origin "$$branch"

tag:
	@branch="$$(git branch --show-current)"; \
	test "$$branch" = "main" || (echo "Tags must be created from main, not $$branch." >&2; exit 1); \
	test -z "$$(git status --porcelain)" || (echo "Repository is dirty. Commit, stash, or discard changes before tagging." >&2; exit 1); \
	git fetch origin main --tags; \
	test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || (echo "main is not synchronized with origin/main." >&2; exit 1); \
	version="$$(node -p "require('./package.json').version")"; \
	tag="v$$version"; \
	test -z "$$(git tag --list "$$tag")" || (echo "Tag $$tag already exists locally." >&2; exit 1); \
	test -z "$$(git ls-remote --tags origin "refs/tags/$$tag")" || (echo "Tag $$tag already exists on origin." >&2; exit 1); \
	git tag -a "$$tag" -m "Release $$tag"; \
	git push origin "$$tag"

release-major:
	$(MAKE) release TYPE=major

release-minor:
	$(MAKE) release TYPE=minor

release-patch:
	$(MAKE) release TYPE=patch

major: release-major
minor: release-minor
patch: release-patch
