"use strict";

const { ipcRenderer } = require("electron");

function findPasswordForm() {
  const passwordInput = document.querySelector('input[type="password"]');
  if (!passwordInput) {
    return null;
  }

  const form = passwordInput.closest("form") || document;
  const inputs = [...form.querySelectorAll("input")];
  const usernameInput = inputs.find((input) => {
    if (input === passwordInput || input.disabled || input.readOnly) {
      return false;
    }

    const type = String(input.type || "text").toLowerCase();
    return ["email", "text", "tel", "url"].includes(type) ||
      /user|email|login|identifier/i.test(`${input.name} ${input.id} ${input.autocomplete}`);
  });

  return {
    form,
    usernameInput,
    passwordInput
  };
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
  const loginForm = findPasswordForm();
  if (!loginForm || loginForm.passwordInput.dataset.dashtopAutofilled === "true") {
    return;
  }

  const credential = await ipcRenderer.invoke("password-manager:get-credential", window.location.href);
  if (!credential) {
    return;
  }

  setInputValue(loginForm.usernameInput, credential.username);
  setInputValue(loginForm.passwordInput, credential.password);
  loginForm.passwordInput.dataset.dashtopAutofilled = "true";
}

function readCredentialFromForm(form) {
  const passwordInput = form.querySelector?.('input[type="password"]') || document.querySelector('input[type="password"]');
  if (!passwordInput) {
    return null;
  }

  const inputs = [...(form.querySelectorAll?.("input") || document.querySelectorAll("input"))];
  const usernameInput = inputs.find((input) => {
    if (input === passwordInput || input.disabled) {
      return false;
    }

    const type = String(input.type || "text").toLowerCase();
    return ["email", "text", "tel", "url"].includes(type) ||
      /user|email|login|identifier/i.test(`${input.name} ${input.id} ${input.autocomplete}`);
  });
  const username = usernameInput?.value || "";
  const password = passwordInput.value || "";

  return username && password
    ? {
        url: window.location.href,
        username,
        password
      }
    : null;
}

function maybeSaveCredentialFrom(target) {
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
      maybeSaveCredentialFrom(target);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target?.matches?.('input[type="password"]')) {
      maybeSaveCredentialFrom(event.target);
    }
  }, true);
}

function scheduleAutofill() {
  setTimeout(() => {
    autofillCredential().catch(() => {});
  }, 250);
}

window.addEventListener("DOMContentLoaded", () => {
  installSubmitCapture();
  scheduleAutofill();

  const observer = new MutationObserver(scheduleAutofill);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
});
