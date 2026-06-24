"use strict";

import type { IpcRendererEvent } from "electron";

const { ipcRenderer } = require("electron");

const PASSWORD_SELECTOR = 'input[type="password"]';
const USERNAME_TYPES = new Set(["email", "text", "tel", "url"]);
let autofillEnabled = false;

type WebAppCredential = { url: string; username: string; password: string };
type PartialWebAppCredential = Partial<WebAppCredential>;
type LoginFields = { form: ParentNode; usernameInput: HTMLInputElement | null; passwordInput: HTMLInputElement | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toPartialWebAppCredential(value: unknown): PartialWebAppCredential {
  return isRecord(value) ? value : {};
}

function isUsernameInput(input: unknown, passwordInput: HTMLInputElement | null = null): input is HTMLInputElement {
  if (!(input instanceof HTMLInputElement) || input === passwordInput || input.disabled || input.readOnly) {
    return false;
  }

  const type = String(input.type || "text").toLowerCase();
  return USERNAME_TYPES.has(type) ||
    /user|email|login|identifier/i.test(`${input.name} ${input.id} ${input.autocomplete}`);
}

function findUsernameInput(scope: ParentNode = document, passwordInput: HTMLInputElement | null = null): HTMLInputElement | null {
  return [...scope.querySelectorAll("input")].find((input) => isUsernameInput(input, passwordInput)) || null;
}

function findLoginFields(): LoginFields {
  const passwordInput = document.querySelector<HTMLInputElement>(PASSWORD_SELECTOR);
  const form = passwordInput?.closest("form") || document;
  const usernameInput = findUsernameInput(form, passwordInput) || findUsernameInput(document, passwordInput);

  return {
    form,
    usernameInput,
    passwordInput
  };
}

function getPendingUsernameKey(): string {
  return `boatyard:password-manager:${window.location.origin}:username`;
}

function getPendingUsername(): string {
  try {
    return sessionStorage.getItem(getPendingUsernameKey()) || "";
  } catch {
    return "";
  }
}

function setPendingUsername(username: unknown): void {
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

function setInputValue(input: HTMLInputElement | null, value: unknown): void {
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

async function autofillCredential(): Promise<void> {
  if (!autofillEnabled) {
    return;
  }

  const loginFields = findLoginFields();
  if (!loginFields.usernameInput && !loginFields.passwordInput) {
    return;
  }

  const credential = toPartialWebAppCredential(await ipcRenderer.invoke("password-manager:get-credential", window.location.href));
  if (!credential.username && !credential.password) {
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

function readCredentialFromForm(form: ParentNode): WebAppCredential | null {
  const passwordInput = (
    form.querySelector(PASSWORD_SELECTOR) || document.querySelector(PASSWORD_SELECTOR)
  ) as HTMLInputElement | null;
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

function rememberUsernameFrom(target: EventTarget | null): void {
  const element = target instanceof Element ? target : null;
  const form = element?.closest("form") || document;
  const usernameInput = findUsernameInput(form) || findUsernameInput(document);
  setPendingUsername(usernameInput?.value);
}

function maybeSaveCredentialFrom(target: EventTarget | null): void {
  rememberUsernameFrom(target);

  const element = target instanceof Element ? target : null;
  const form = element?.closest("form") || document;
  const credential = readCredentialFromForm(form);
  if (credential) {
    ipcRenderer.invoke("password-manager:save-credential", credential).catch(() => {});
  }
}

function installSubmitCapture(): void {
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

    const typedTarget = target as HTMLElement & { type?: string, value?: string };
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
    const target = event.target;
    if (isUsernameInput(target)) {
      setPendingUsername(target.value);
    }
  }, true);
}

function scheduleAutofill(): void {
  setTimeout(() => {
    autofillCredential().catch(() => {});
  }, 250);
}

ipcRenderer.on("webapp:autofill-enabled", (_event: IpcRendererEvent, enabled: unknown) => {
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

export {};
