.PHONY: build check dist install package run

install:
	npm install

run:
	DISPLAY=:0 BOATYARD_STATE_PATH=.boatyard-state.json npm start -- --no-sandbox

check:
	npm run lint
	npm test

build: check
	npm run package

package: build

dist: check
	npm run dist
