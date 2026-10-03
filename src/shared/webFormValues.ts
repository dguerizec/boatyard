export type WebFormValue = string | boolean | string[];

// Keep these functions self-contained so the main process can serialize them into a web page.
export function readWebFormValue(element: Element): WebFormValue | null {
  if (element instanceof HTMLInputElement) {
    if (["checkbox", "radio"].includes(element.type)) return element.checked;
    if (["hidden", "file", "button", "submit", "reset", "image"].includes(element.type)) return null;
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement) {
    return element.multiple ? [...element.selectedOptions].map(option => option.value) : element.value;
  }
  if (element instanceof HTMLElement && element.isContentEditable) return element.textContent || "";
  return null;
}

export function setWebFormValue(element: Element, value: WebFormValue): void {
  if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
    if (typeof value !== "boolean" || (element.type === "radio" && !value)) throw new Error("Invalid checked value.");
    // Activation gives controlled checkboxes/radios their usual click/input/change events.
    if (element.checked !== value) element.click();
    return;
  }
  if (element instanceof HTMLSelectElement && element.multiple) {
    if (!Array.isArray(value)) throw new Error("A multiple select requires an array.");
    for (const option of element.options) {
      Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, "selected")!.set!.call(option, value.includes(option.value));
    }
  } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    if (typeof value !== "string") throw new Error("The field requires a string.");
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  } else if (element instanceof HTMLElement && element.isContentEditable) {
    if (typeof value !== "string") throw new Error("An editable field requires a string.");
    element.textContent = value;
  } else {
    throw new Error("Unsupported field.");
  }
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
