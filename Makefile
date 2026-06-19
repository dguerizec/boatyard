.PHONY: build check deps dist install major minor package patch release release-major release-minor release-patch run

deps: node_modules/.package-lock.stamp

node_modules/.package-lock.stamp: package.json package-lock.json
	npm install
	touch node_modules/.package-lock.stamp

install:
	npm install
	touch node_modules/.package-lock.stamp

run: deps
	DISPLAY=:0 BOATYARD_STATE_PATH=.boatyard-state.json npm start -- --no-sandbox

check: deps
	npm run lint
	npm test

build: check
	npm run package

package: build

dist: check
	npm run dist

release:
	@test -n "$(TYPE)" || (echo "TYPE is required. Use release-major, release-minor, or release-patch." >&2; exit 1)
	@test -z "$$(git status --porcelain)" || (echo "Repository is dirty. Commit, stash, or discard changes before releasing." >&2; exit 1)
	@branch="$$(git branch --show-current)"; \
	test -n "$$branch" || (echo "Cannot release from a detached HEAD." >&2; exit 1); \
	test "$$branch" = "main" || (echo "Releases must be created from main, not $$branch." >&2; exit 1); \
	version="$$(npm version $(TYPE) -m "Release %s")"; \
	git push origin "$$branch"; \
	git push origin "$$version"

release-major:
	$(MAKE) release TYPE=major

release-minor:
	$(MAKE) release TYPE=minor

release-patch:
	$(MAKE) release TYPE=patch

major: release-major
minor: release-minor
patch: release-patch
