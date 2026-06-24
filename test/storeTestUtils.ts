"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { ProjectStore } = require(`${process.cwd()}/build/main/store`);

function createTempStoreFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-store-"));
  return {
    directory,
    filePath: path.join(directory, "state.json")
  };
}

function createTempStore() {
  const { directory, filePath } = createTempStoreFile();
  return {
    directory,
    filePath,
    store: new ProjectStore(filePath)
  };
}

export {
  ProjectStore,
  createTempStore,
  createTempStoreFile
};
