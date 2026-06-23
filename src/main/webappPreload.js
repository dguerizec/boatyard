// @ts-check
"use strict";

const { ipcRenderer } = require("electron");

const PASSWORD_SELECTOR = 'input[type="password"]';
const USERNAME_TYPES = new Set(["email", "text", "tel", "url"]);
let autofillEnabled = false;

/**
 * @typedef {{ url: string, username: string, password: string }} WebAppCredential
 * @typedef {{ form: ParentNode, usernameInput: HTMLInputElement | null, passwordInput: HTMLInputElement | null }} LoginFields
 */

/**
 * @param {unknown} input
 * @param {HTMLInputElement | null} passwordInput
 * @returns {input is HTMLInputElement}
 */
function isUsernameInput(input, passwordInput = null) {
  if (!(input instanceof HTMLInputElement) || input === passwordInput || input.disabled || input.readOnly) {
    return false;
  }

  const type = String(input.type || "text").toLowerCase();
  return USERNAME_TYPES.has(type) ||
    /user|email|login|identifier/i.test(`${input.name} ${input.id} ${input.autocomplete}`);
}

/**
 * @param {ParentNode} scope
 * @param {HTMLInputElement | null} passwordInput
 * @returns {HTMLInputElement | null}
 */
function findUsernameInput(scope = document, passwordInput = null) {
  return [...scope.querySelectorAll("input")].find((input) => isUsernameInput(input, passwordInput)) || null;
}

/**
 * @returns {LoginFields}
 */
function findLoginFields() {
  const passwordInput = /** @type {HTMLInputElement | null} */ (document.querySelector(PASSWORD_SELECTOR));
  const form = passwordInput?.closest("form") || document;
  const usernameInput = findUsernameInput(form, passwordInput) || findUsernameInput(document, passwordInput);

  return {
    form,
    usernameInput,
    passwordInput
  };
}

/**
 * @returns {string}
 */
function getPendingUsernameKey() {
  return `boatyard:password-manager:${window.location.origin}:username`;
}

/**
 * @returns {string}
 */
function getPendingUsername() {
  try {
    return sessionStorage.getItem(getPendingUsernameKey()) || "";
  } catch {
    return "";
  }
}

/**
 * @param {unknown} username
 */
function setPendingUsername(username) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) {
    return;
  }

  try {
    sessionStorage.setItem(getPendingUsernameKey(), normalizedUsername);
  } catch {
    // Ignore storage failures in constrained webapp contexts.
  }
}

/**
 * @param {HTMLInputElement | null} input
 * @param {unknown} value
 */
function setInputValue(input, value) {
  if (!input || !value) {
    return;
  }

  const valueSetter = Object.getOwnPropertyDescriptor(input.constructor.prototype, "value")?.set;
  if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = String(value);
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * @returns {Promise<void>}
 */
async function autofillCredential() {
  if (!autofillEnabled) {
    return;
  }

  const loginFields = findLoginFields();
  if (!loginFields.usernameInput && !loginFields.passwordInput) {
    return;
  }

  const credential = await ipcRenderer.invoke("password-manager:get-credential", window.location.href);
  if (!credential || typeof credential !== "object") {
    return;
  }

  const normalizedCredential = /** @type {Partial<WebAppCredential>} */ (credential);
  let didAutofill = false;
  if (loginFields.usernameInput && loginFields.usernameInput.dataset.boatyardAutofilled !== "true") {
    setInputValue(loginFields.usernameInput, normalizedCredential.username);
    loginFields.usernameInput.dataset.boatyardAutofilled = "true";
    setPendingUsername(normalizedCredential.username);
    didAutofill = true;
  }

  if (loginFields.passwordInput && loginFields.passwordInput.dataset.boatyardAutofilled !== "true") {
    setInputValue(loginFields.passwordInput, normalizedCredential.password);
    loginFields.passwordInput.dataset.boatyardAutofilled = "true";
    didAutofill = true;
  }

  if (didAutofill) {
    autofillEnabled = false;
    ipcRenderer.invoke("webapp:autofill-consumed").catch(() => {});
  }
}

/**
 * @param {ParentNode} form
 * @returns {WebAppCredential | null}
 */
function readCredentialFromForm(form) {
  const passwordInput = /** @type {HTMLInputElement | null} */ (
    form.querySelector(PASSWORD_SELECTOR) || document.querySelector(PASSWORD_SELECTOR)
  );
  if (!passwordInput) {
    return null;
  }

  const usernameInput = findUsernameInput(form, passwordInput) || findUsernameInput(document, passwordInput);
  const username = usernameInput?.value || getPendingUsername();
  const password = passwordInput.value || "";

  return username && password
    ? {
        url: window.location.href,
        username,
        password
      }
    : null;
}

/**
 * @param {EventTarget | null} target
 */
function rememberUsernameFrom(target) {
  const element = target instanceof Element ? target : null;
  const form = element?.closest("form") || document;
  const usernameInput = findUsernameInput(form) || findUsernameInput(document);
  setPendingUsername(usernameInput?.value);
}

/**
 * @param {EventTarget | null} target
 */
function maybeSaveCredentialFrom(target) {
  rememberUsernameFrom(target);

  const element = target instanceof Element ? target : null;
  const form = element?.closest("form") || document;
  const credential = readCredentialFromForm(form);
  if (credential) {
    ipcRenderer.invoke("password-manager:save-credential", credential).catch(() => {});
  }
}

function installSubmitCapture() {
  document.addEventListener("submit", (event) => {
    maybeSaveCredentialFrom(event.target);
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("button, input, [role='button']")
      : null;
    if (!target) {
      return;
    }

    const typedTarget = /** @type {HTMLElement & { type?: string, value?: string }} */ (target);
    const type = String(typedTarget.type || "").toLowerCase();
    const label = `${typedTarget.textContent || ""} ${typedTarget.value || ""} ${typedTarget.getAttribute("aria-label") || ""}`;
    if (type === "submit" || /sign|log.?in|continue|connect|next/i.test(label)) {
      rememberUsernameFrom(target);
      maybeSaveCredentialFrom(target);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === "Enter" && target?.matches("input")) {
      rememberUsernameFrom(event.target);
    }

    if (event.key === "Enter" && target?.matches(PASSWORD_SELECTOR)) {
      maybeSaveCredentialFrom(event.target);
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (isUsernameInput(event.target)) {
      setPendingUsername(event.target.value);
    }
  }, true);
}

function scheduleAutofill() {
  setTimeout(() => {
    autofillCredential().catch(() => {});
  }, 250);
}

ipcRenderer.on("webapp:autofill-enabled", (_event, enabled) => {
  autofillEnabled = enabled === true;
  if (autofillEnabled) {
    scheduleAutofill();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  installSubmitCapture();
  scheduleAutofill();

  const observer = new MutationObserver(scheduleAutofill);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
});
