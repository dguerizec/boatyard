.PHONY: build dist install package run

install:
	npm install

run:
	DISPLAY=:0 DASHTOP_STATE_PATH=.dashtop-state.json npm start -- --no-sandbox

build:
	npm run lint
	npm test

package: build
	npm run package

dist: build
	npm run dist
