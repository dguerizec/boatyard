# Fill form fields through Boatyard MCP

`fill_pane` fills explicit CSS-selected fields in an existing visible web pane.
It does not press Enter, click a submit button, or call a form submission method.
Page handlers still receive normal field events and may perform their own saves.

Inspect `list_windows`, `get_pane_layout`, and `list_pane_types` first. The
selected pane exposes `interaction.available`; its choice exposes
`capabilities.fill`. Supply `contextId`, `windowId`, `projectId`, `paneId`, the
latest `revision` as `expectedRevision`, and `navigation.currentUrl` as
`expectedUrl`, just as for `click_pane`.

The `fields` array accepts 1 to 50 entries:

```json
{
  "fields": [
    { "selector": "#name", "value": "Example", "expectedValue": "draft" },
    { "selector": "textarea[name=notes]", "value": "First line\nSecond line" },
    { "selector": "#enabled", "value": true },
    { "selector": "select[name=mode]", "value": "advanced" },
    { "selector": "select[multiple]", "value": ["a", "b"] }
  ]
}
```

| Field | Value |
| --- | --- |
| Text input, password, number, date, textarea | String, including an empty string |
| Single select | An enabled option's value |
| Multiple select | An array of enabled option values; `[]` clears it |
| Checkbox | Boolean |
| Radio | `true` to select it and clear its group |
| `contenteditable` | Plain text; replaces its contents without interpreting HTML |

Selectors target the main document only, with exactly one match per field.
They do not traverse iframes or shadow roots. Fields must be rendered, enabled,
and writable, but may be outside the scroll viewport. Filling does not scroll
or focus the pane. Hidden inputs, files, buttons, and custom editor APIs are
unsupported. Native value setters and bubbling `input`/`change` events notify
page listeners; checkbox and radio activation uses the control's `click()`.
These events are programmatic, unlike `click_pane`'s native mouse input.

The whole batch is validated before the first mutation: targets, value types,
browser input sanitization, enabled select options, duplicate targets, radio
conflicts, and optional `expectedValue` checks. Validation errors modify no
fields. `expectedValue` compares the existing value before filling, protecting
a draft. Multiple-select comparisons ignore option order.

Boatyard revalidates the pane and actual page URL before executing the batch.
Page handlers can change fields or navigate during filling. In that case,
Boatyard stops, reports partial results, and marks remaining fields
`NOT_ATTEMPTED`; it does not roll back earlier changes or retry automatically.
Check `allSucceeded`, `filledCount`, and each result's `filled`/`code`. Results
include selectors but never echo field values. Verify the page or application
state afterward, especially for custom controlled editors or asynchronous saves.

Build and restart Boatyard to load the tool. Refresh the MCP connection or
restart agents that cache tools, and update the installed skill from
Global settings > MCP.

## Credential exclusion for gateways

The optional `rejectCredentialFields: true` guard rejects password inputs,
fields whose autocomplete tokens include username, current-password,
new-password or one-time-code, and every field inside a form containing a
password input. It checks this before reading values or writing the batch,
again before each write, and during final observation. A later handler can
change another field into a credential field; that field is refused with
`CREDENTIAL_FIELD_FORBIDDEN`. Successful guarded invocation receipts include
`credentialPolicyApplied: true`. This is recognition of DOM markers, not a
universal sensitive-data classifier: unmarked login fields and custom widgets
may not be recognized. Keep secrets in the saved-local autofill flow.

The option is additive: existing direct MCP callers retain their contract.
Gateways should require `expectedValue` for every ordinary field and pin the
new native schema. Do not silently drop the credential guard for older servers.

## Version 2 input receipts

`receiptVersion: 2` is an optional input requirement for gateways. The native
handler returns version 2 receipts with `attemptedCount`, `appliedCount`,
`pageChangedDuringFill` and per-field `attempted`/`applied` alongside the legacy
`filled`, `filledCount` and `allSucceeded` final-observation fields.

`attempted` records invocation of the field setter. `applied:true` means the
requested value was observed on the original field immediately after the setter
and its synchronous handlers returned. Already-matching values are included.
`applied:false` means no write was attempted or the immediate value did not
match; `applied:null` means the invocation could not be confirmed (for example,
a setter writes and then throws, or the field becomes credential-bearing).
These facts are never erased by later observation failure. They do not prove a
durable save, authentication, or the final application's state.

An input handler can change the URL using History APIs while retaining the field.
The receipt then preserves `attempted:true`/`applied:true`, reports `PAGE_CHANGED`
and stops later fields as `NOT_ATTEMPTED`. Search and clearing are both supported
by this reporting contract. Exact URL guards remain strict: no same-origin,
query-only or SPA exemption permits further writes. The final legacy `filled`
flag stays false on page change; gateways must project the separate facts.
Document navigation can also discard the execution context or the reply; this
remains uncertain rather than being reconstructed from the new page. Never replay
`PAGE_CHANGED`, partial input or an uncertain invocation automatically.

Validation (2026-10-04): all 732 tests passed, including real isolated browser
search/clear History updates, a stopped batch tail and a setter that writes then
throws while changing the URL. Typecheck, lint and the registered MCP schema
export passed. The native application must be restarted to load this correction;
no personal-page write or application restart was used for this validation.
