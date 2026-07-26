export const GLOBAL_SETTINGS_SAVE_REQUEST_EVENT = "boatyard:global-settings-save-request";

export type GlobalSettingsFormController = {
  getState: () => unknown;
  save: () => Promise<void>;
};

type BindGlobalSettingsFormOptions<T> = {
  error: HTMLElement;
  form: HTMLFormElement;
  getValues: () => T;
  onSubmit: (values: T) => void | Promise<void>;
  root: HTMLElement;
  validate?: (values: T) => string;
};

const controllers = new WeakMap<HTMLElement, GlobalSettingsFormController>();

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function serializeGlobalSettingsState(value: unknown) {
  return JSON.stringify(value);
}

export function registerGlobalSettingsFormController(
  root: HTMLElement,
  controller: GlobalSettingsFormController
) {
  controllers.set(root, controller);
  return root;
}

export function getGlobalSettingsFormController(root: HTMLElement) {
  return controllers.get(root) || null;
}

export function bindGlobalSettingsForm<T>({
  error,
  form,
  getValues,
  onSubmit,
  root,
  validate
}: BindGlobalSettingsFormOptions<T>) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    root.dispatchEvent(new CustomEvent(GLOBAL_SETTINGS_SAVE_REQUEST_EVENT, {
      bubbles: true
    }));
  });

  registerGlobalSettingsFormController(root, {
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
