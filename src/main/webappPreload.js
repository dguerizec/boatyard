"use strict";

const { ipcRenderer } = require("electron");

const PASSWORD_SELECTOR = 'input[type="password"]';
const USERNAME_TYPES = new Set(["email", "text", "tel", "url"]);
let autofillEnabled = false;

function isUsernameInput(input, passwordInput = null) {
  if (!input || input === passwordInput || input.disabled || input.readOnly) {
    return false;
  }

  const type = String(input.type || "text").toLowerCase();
  return USERNAME_TYPES.has(type) ||
    /user|email|login|identifier/i.test(`${input.name} ${input.id} ${input.autocomplete}`);
}

function findUsernameInput(scope = document, passwordInput = null) {
  return [...(scope.querySelectorAll?.("input") || [])].find((input) => isUsernameInput(input, passwordInput)) || null;
}

function findLoginFields() {
  const passwordInput = document.querySelector(PASSWORD_SELECTOR);
  const form = passwordInput?.closest("form") || document;
  const usernameInput = findUsernameInput(form, passwordInput) || findUsernameInput(document, passwordInput);

  return {
    form,
    usernameInput,
    passwordInput
  };
}

function getPendingUsernameKey() {
  return `boatyard:password-manager:${window.location.origin}:username`;
}

function getPendingUsername() {
  try {
    return sessionStorage.getItem(getPendingUsernameKey()) || "";
  } catch {
    return "";
  }
}

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

function setInputValue(input, value) {
  if (!input || !value) {
    return;
  }

  const valueSetter = Object.getOwnPropertyDescriptor(input.constructor.prototype, "value")?.set;
  if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function autofillCredential() {
  if (!autofillEnabled) {
    return;
  }

  const loginFields = findLoginFields();
  if (!loginFields.usernameInput && !loginFields.passwordInput) {
    return;
  }

  const credential = await ipcRenderer.invoke("password-manager:get-credential", window.location.href);
  if (!credential) {
    return;
  }

  let didAutofill = false;
  if (loginFields.usernameInput && loginFields.usernameInput.dataset.boatyardAutofilled !== "true") {
    setInputValue(loginFields.usernameInput, credential.username);
    loginFields.usernameInput.dataset.boatyardAutofilled = "true";
    setPendingUsername(credential.username);
    didAutofill = true;
  }

  if (loginFields.passwordInput && loginFields.passwordInput.dataset.boatyardAutofilled !== "true") {
    setInputValue(loginFields.passwordInput, credential.password);
    loginFields.passwordInput.dataset.boatyardAutofilled = "true";
    didAutofill = true;
  }

  if (didAutofill) {
    autofillEnabled = false;
    ipcRenderer.invoke("webapp:autofill-consumed").catch(() => {});
  }
}

function readCredentialFromForm(form) {
  const passwordInput = form.querySelector?.(PASSWORD_SELECTOR) || document.querySelector(PASSWORD_SELECTOR);
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

function rememberUsernameFrom(target) {
  const form = target?.closest?.("form") || document;
  const usernameInput = findUsernameInput(form) || findUsernameInput(document);
  setPendingUsername(usernameInput?.value);
}

function maybeSaveCredentialFrom(target) {
  rememberUsernameFrom(target);

  const form = target?.closest?.("form") || document;
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
    const target = event.target?.closest?.("button, input, [role='button']");
    if (!target) {
      return;
    }

    const type = String(target.type || "").toLowerCase();
    const label = `${target.textContent || ""} ${target.value || ""} ${target.getAttribute("aria-label") || ""}`;
    if (type === "submit" || /sign|log.?in|continue|connect|next/i.test(label)) {
      rememberUsernameFrom(target);
      maybeSaveCredentialFrom(target);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target?.matches?.("input")) {
      rememberUsernameFrom(event.target);
    }

    if (event.key === "Enter" && event.target?.matches?.(PASSWORD_SELECTOR)) {
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
