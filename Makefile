.PHONY: build install run

install:
	npm install

run:
	DISPLAY=:0 DASHTOP_STATE_PATH=.dashtop-state.json npm start -- --no-sandbox

build:
	npm run lint
	npm test
