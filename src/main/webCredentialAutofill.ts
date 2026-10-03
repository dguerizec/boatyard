export type AutofillField = { value: string; dataset: { boatyardAutofilled?: string } };
export type AutofillFields<T extends AutofillField> = { usernameInput: T | null; passwordInput: T | null };
export type AutofillOutcome = "waiting" | "consumed" | "page_changed" | "draft_present";

// Credentials remain inside the main/preload path. Results never contain field values.
export async function fillSavedCredential<T extends AutofillField>({
  expectedUrl, getUrl, getFields, getCredential, setValue, onUsername, isActive = () => true
}: {
  expectedUrl: string | null;
  getUrl(): string;
  getFields(): AutofillFields<T>;
  getCredential(): Promise<{ username?: string; password?: string }>;
  setValue(input: T, value: string): void;
  onUsername(value: string): void;
  isActive?(): boolean;
}): Promise<AutofillOutcome> {
  const current = () => isActive() && (expectedUrl === null || getUrl() === expectedUrl);
  if (!current()) return "page_changed";
  const fields = getFields();
  if (!fields.usernameInput && !fields.passwordInput) return "waiting";
  if (expectedUrl !== null && [fields.usernameInput, fields.passwordInput].some((input) => input?.value)) {
    return "draft_present";
  }
  const credential = await getCredential();
  if (!current()) return "page_changed";
  if (expectedUrl !== null) {
    const latest = getFields();
    if (latest.usernameInput !== fields.usernameInput || latest.passwordInput !== fields.passwordInput ||
        [fields.usernameInput, fields.passwordInput].some((input) => input?.value)) return "draft_present";
  }
  if (!credential.username && !credential.password) return "waiting";
  let changed = false;
  if (fields.usernameInput && fields.usernameInput.dataset.boatyardAutofilled !== "true" && credential.username) {
    setValue(fields.usernameInput, credential.username);
    fields.usernameInput.dataset.boatyardAutofilled = "true";
    onUsername(credential.username);
    changed = true;
  }
  // Page event handlers can navigate synchronously when the username is filled.
  if (!current()) return "page_changed";
  if (expectedUrl !== null && fields.passwordInput &&
      (fields.passwordInput.value || getFields().passwordInput !== fields.passwordInput)) return "draft_present";
  if (fields.passwordInput && fields.passwordInput.dataset.boatyardAutofilled !== "true" && credential.password) {
    setValue(fields.passwordInput, credential.password);
    fields.passwordInput.dataset.boatyardAutofilled = "true";
    changed = true;
  }
  return changed ? "consumed" : "waiting";
}
