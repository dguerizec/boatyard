import { z } from "zod";
import { readWebFormValue, setWebFormValue, type WebFormValue } from "../shared/webFormValues.js";

const valueSchema = z.union([z.string().max(16384), z.boolean(), z.array(z.string().max(16384)).max(100)]);
export const webFormFieldsSchema = z.array(z.object({
  selector: z.string().trim().min(1).max(512),
  value: valueSchema,
  expectedValue: valueSchema.optional()
}).strict()).min(1).max(50);

type WebFormField = z.infer<typeof webFormFieldsSchema>[number];
type FieldOutcome = { selector: string; filled: boolean; attempted: boolean; applied: boolean | null; code?: string };
export type WebFormFillResult = {
  receiptVersion: 2;
  attemptedCount: number;
  appliedCount: number;
  pageChangedDuringFill: boolean;
  allSucceeded: boolean;
  filledCount: number;
  results: FieldOutcome[];
  code?: string;
};

function fillWebForm(
  expectedUrl: string, fields: WebFormField[], rejectCredentialFields: boolean,
  readValue: typeof readWebFormValue, setValue: typeof setWebFormValue
): WebFormFillResult {
  const equal = (left: WebFormValue | null, right: WebFormValue | null) => {
    const normalize = (value: WebFormValue | null) => Array.isArray(value) ? [...value].sort() : value;
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
  };
  const failure = (selector: string, code: string): WebFormFillResult => ({
    receiptVersion: 2, attemptedCount: 0, appliedCount: 0, pageChangedDuringFill: code === "PAGE_CHANGED",
    code, allSucceeded: false, filledCount: 0, results: [{ selector, filled: false, attempted: false, applied: false, code }]
  });
  const editable = (element: Element) => element.isConnected &&
    element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
    !element.matches(":disabled, [readonly]") && !element.closest('[inert], [aria-disabled="true"]');
  const credentialField = (element: Element) => {
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/);
    return (element instanceof HTMLInputElement && element.type === "password") ||
      autocomplete.some(token => ["username", "current-password", "new-password", "one-time-code"].includes(token)) ||
      Boolean(element.closest("form")?.querySelector('input[type="password"]'));
  };
  if (location.href !== expectedUrl) return failure("", "PAGE_CHANGED");
  const prepared: Array<{ field: WebFormField; element: Element; previous: WebFormValue }> = [];
  for (const field of fields) {
    let matches: NodeListOf<Element>;
    try { matches = document.querySelectorAll(field.selector); }
    catch { return failure(field.selector, "INVALID_SELECTOR"); }
    if (!matches.length) return failure(field.selector, "ELEMENT_NOT_FOUND");
    if (matches.length !== 1) return failure(field.selector, "ELEMENT_AMBIGUOUS");
    const element = matches[0];
    if (prepared.some(item => item.element === element)) return failure(field.selector, "DUPLICATE_FIELD");
    if (rejectCredentialFields && credentialField(element)) return failure(field.selector, "CREDENTIAL_FIELD_FORBIDDEN");
    const previous = readValue(element);
    if (previous === null) return failure(field.selector, "FIELD_NOT_SUPPORTED");
    if (!editable(element)) return failure(field.selector, "FIELD_NOT_EDITABLE");
    if (field.expectedValue !== undefined && !equal(previous, field.expectedValue)) return failure(field.selector, "FIELD_CHANGED");
    if (typeof previous !== typeof field.value || Array.isArray(previous) !== Array.isArray(field.value)) {
      return failure(field.selector, "INVALID_FIELD_VALUE");
    }
    if (element instanceof HTMLInputElement && element.type === "radio") {
      if (field.value !== true) return failure(field.selector, "INVALID_FIELD_VALUE");
      if (element.name && prepared.some(item => item.element instanceof HTMLInputElement &&
          item.element.type === "radio" && item.element.name === element.name &&
          item.element.form === element.form && item.element.getRootNode() === element.getRootNode())) {
        return failure(field.selector, "CONFLICTING_RADIO_FIELDS");
      }
    }
    if (element instanceof HTMLSelectElement) {
      const values = Array.isArray(field.value) ? field.value : [field.value];
      if (new Set(values).size !== values.length || values.some(value => ![...element.options].some(option =>
          option.value === value && !option.disabled && !option.closest("optgroup[disabled]")))) {
        return failure(field.selector, "INVALID_FIELD_VALUE");
      }
    }
    if (element instanceof HTMLInputElement && typeof field.value === "string") {
      // Validate browser value sanitization without touching the live field or running its handlers.
      const probe = element.cloneNode() as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(probe, field.value);
      if (probe.value !== field.value) return failure(field.selector, "INVALID_FIELD_VALUE");
    }
    prepared.push({ field, element, previous });
  }
  const results: FieldOutcome[] = [];
  let pageChangedDuringFill = false;
  const pageChanged = () => {
    pageChangedDuringFill ||= location.href !== expectedUrl;
    return pageChangedDuringFill;
  };
  for (const { field, element, previous } of prepared) {
    let code: string | undefined;
    let attempted = false;
    let applied: boolean | null = false;
    const matches = document.querySelectorAll(field.selector);
    if (pageChanged()) code = "PAGE_CHANGED";
    else if (matches.length !== 1 || matches[0] !== element) code = "FIELD_CHANGED";
    else if (rejectCredentialFields && credentialField(element)) code = "CREDENTIAL_FIELD_FORBIDDEN";
    else if (!equal(readValue(element), previous)) code = "FIELD_CHANGED";
    else if (!editable(element)) code = "FIELD_NOT_EDITABLE";
    else {
      try {
        attempted = true;
        applied = null;
        setValue(element, field.value);
        if (rejectCredentialFields && credentialField(element)) code = "CREDENTIAL_FIELD_FORBIDDEN";
        else {
          applied = equal(readValue(element), field.value);
          if (!applied) code = "FIELD_VALUE_REJECTED";
        }
        // Preserve the immediate value acknowledgement even if handlers changed the URL.
        // Never continue writing another field on the changed page.
        if (pageChanged()) code = "PAGE_CHANGED";
      } catch {
        code = "FIELD_FILL_FAILED";
        pageChanged();
      }
    }
    results.push({ selector: field.selector, filled: !code, attempted, applied, ...(code ? { code } : {}) });
    // Page handlers can navigate, replace fields, or change a later draft; stop at the first failure.
    if (code) {
      for (const item of prepared.slice(results.length)) {
        results.push({ selector: item.field.selector, filled: false, attempted: false, applied: false, code: "NOT_ATTEMPTED" });
      }
      break;
    }
  }
  for (let index = 0; index < results.length; index += 1) {
    if (!results[index].filled) continue;
    const { field } = prepared[index];
    const matches = document.querySelectorAll(field.selector);
    const forbidden = matches.length === 1 && rejectCredentialFields && credentialField(matches[0]);
    if (pageChanged() || matches.length !== 1 || matches[0] !== prepared[index].element || forbidden || !equal(readValue(matches[0]), field.value)) {
      results[index] = { ...results[index], filled: false, code: pageChangedDuringFill ? "PAGE_CHANGED" : forbidden ? "CREDENTIAL_FIELD_FORBIDDEN" : "FIELD_VALUE_REJECTED" };
    }
  }
  const filledCount = results.filter(result => result.filled).length;
  return {
    receiptVersion: 2,
    attemptedCount: results.filter(result => result.attempted).length,
    appliedCount: results.filter(result => result.applied === true).length,
    pageChangedDuringFill,
    allSucceeded: filledCount === fields.length, filledCount, results
  };
}

export function createWebFormFillScript(expectedUrl: string, fields: WebFormField[], rejectCredentialFields = false): string {
  return `(${fillWebForm.toString()})(${JSON.stringify(expectedUrl)}, ${JSON.stringify(fields)}, ${JSON.stringify(rejectCredentialFields)}, (${readWebFormValue.toString()}), (${setWebFormValue.toString()}))`;
}
