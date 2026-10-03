import assert from "node:assert/strict";
import test from "node:test";
import { fillSavedCredential } from "../src/main/webCredentialAutofill.js";

function fixture() {
  const usernameInput = { value: "", dataset: {} };
  const passwordInput = { value: "", dataset: {} };
  const fields = { usernameInput, passwordInput };
  let url = "https://login.example.test/";
  let reads = 0;
  const options = {
    expectedUrl: url as string | null,
    getUrl: () => url,
    getFields: () => fields,
    getCredential: async () => { reads += 1; return { username: "local-user", password: "local-secret" }; },
    setValue: (input: { value: string }, value: string) => { input.value = value; },
    onUsername() {}
  };
  return { fields, options, setUrl(value: string) { url = value; }, reads: () => reads };
}

test("scoped saved credentials fill locally and return only an outcome", async () => {
  const f = fixture();
  assert.equal(await fillSavedCredential(f.options), "consumed");
  assert.equal(f.fields.usernameInput.value, "local-user");
  assert.equal(f.fields.passwordInput.value, "local-secret");
});

test("changed page before retrieval never requests saved credentials", async () => {
  const f = fixture();
  f.setUrl("https://other.example.test/");
  assert.equal(await fillSavedCredential(f.options), "page_changed");
  assert.equal(f.reads(), 0);
});

test("navigation during local credential retrieval never fills the new page", async () => {
  const f = fixture();
  f.options.getCredential = async () => { f.setUrl("https://other.example.test/"); return { username: "local-user", password: "local-secret" }; };
  assert.equal(await fillSavedCredential(f.options), "page_changed");
  assert.equal(f.fields.usernameInput.value, "");
  assert.equal(f.fields.passwordInput.value, "");
});

test("existing and newly typed drafts are preserved", async () => {
  const f = fixture();
  f.fields.usernameInput.value = "draft";
  assert.equal(await fillSavedCredential(f.options), "draft_present");
  assert.equal(f.reads(), 0);
  f.fields.usernameInput.value = "";
  f.options.getCredential = async () => { f.fields.passwordInput.value = "new-draft"; return { username: "local-user", password: "local-secret" }; };
  assert.equal(await fillSavedCredential(f.options), "draft_present");
  assert.equal(f.fields.passwordInput.value, "new-draft");
});

test("username handlers changing the page cannot receive the password", async () => {
  const f = fixture();
  f.options.onUsername = () => { f.setUrl("https://other.example.test/"); };
  assert.equal(await fillSavedCredential(f.options), "page_changed");
  assert.equal(f.fields.usernameInput.value, "local-user");
  assert.equal(f.fields.passwordInput.value, "");
});

test("username handlers creating a password draft preserve it", async () => {
  const f = fixture();
  f.options.onUsername = () => { f.fields.passwordInput.value = "new-draft"; };
  assert.equal(await fillSavedCredential(f.options), "draft_present");
  assert.equal(f.fields.passwordInput.value, "new-draft");
});

test("legacy toolbar autofill keeps its existing draft replacement behavior", async () => {
  const f = fixture();
  f.options.expectedUrl = null;
  f.fields.usernameInput.value = "old";
  assert.equal(await fillSavedCredential(f.options), "consumed");
  assert.equal(f.fields.usernameInput.value, "local-user");
});

test("disabling an in-flight request prevents local secrets from being filled", async () => {
  const f = fixture();
  let active = true;
  f.options.getCredential = async () => { active = false; return { username: "local-user", password: "local-secret" }; };
  assert.equal(await fillSavedCredential({ ...f.options, isActive: () => active }), "page_changed");
  assert.equal(f.fields.usernameInput.value, "");
  assert.equal(f.fields.passwordInput.value, "");
});
