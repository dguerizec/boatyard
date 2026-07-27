export const SETTINGS_SAVE_REQUEST_EVENT = "boatyard:settings-save-request";
export const SETTINGS_STATE_CHANGED_EVENT = "boatyard:settings-state-changed";

export type SettingsFormController = {
  getState: () => unknown;
  save: () => Promise<void>;
};

type BindSettingsFormOptions<T> = {
  error: HTMLElement;
  form: HTMLFormElement;
  getValues: () => T;
  onSubmit: (values: T) => void | Promise<void>;
  root: HTMLElement;
  validate?: (values: T) => string;
};

const controllers = new WeakMap<HTMLElement, SettingsFormController>();

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function serializeSettingsState(value: unknown) {
  return JSON.stringify(value);
}

export function registerSettingsFormController(
  root: HTMLElement,
  controller: SettingsFormController
) {
  controllers.set(root, controller);
  return root;
}

export function getSettingsFormController(root: HTMLElement) {
  return controllers.get(root) || null;
}

export function hasActiveSettingsInteraction(root: ParentNode = document) {
  const shell = root.querySelector<HTMLElement>(".settings-shell");
  return Boolean(shell && (
    shell.classList.contains("dirty") ||
    shell.matches(":focus-within")
  ));
}

export function notifySettingsStateChanged(target: EventTarget) {
  target.dispatchEvent(new CustomEvent(SETTINGS_STATE_CHANGED_EVENT, {
    bubbles: true
  }));
}

export function bindSettingsForm<T>({
  error,
  form,
  getValues,
  onSubmit,
  root,
  validate
}: BindSettingsFormOptions<T>) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    root.dispatchEvent(new CustomEvent(SETTINGS_SAVE_REQUEST_EVENT, {
      bubbles: true
    }));
  });

  registerSettingsFormController(root, {
    getState: getValues,
    async save() {
      error.textContent = "";
      error.hidden = true;
      const values = getValues();
      const validationError = validate?.(values) || "";
      if (validationError) {
        error.textContent = validationError;
        error.hidden = false;
        throw new Error(validationError);
      }

      try {
        await onSubmit(values);
      } catch (submitError) {
        error.textContent = asErrorMessage(submitError);
        error.hidden = false;
        throw submitError;
      }
    }
  });

  return root;
}
