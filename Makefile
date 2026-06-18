.PHONY: build check deps dist install package run

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
