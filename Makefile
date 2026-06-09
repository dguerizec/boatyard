.PHONY: build dist install package run

install:
	npm install

run:
	DISPLAY=:0 BOATYARD_STATE_PATH=.boatyard-state.json npm start -- --no-sandbox

build:
	npm run lint
	npm test

package: build
	npm run package

dist: build
	npm run dist
