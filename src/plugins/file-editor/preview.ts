import DOMPurify from "dompurify";
import { marked } from "marked";

const mermaidUrl = new URL("mermaid.js", (document.currentScript as HTMLScriptElement | null)?.src || location.href).href;
let diagramModule: Promise<typeof import("./mermaid")> | undefined;

export function supportsPreview(path: string): boolean {
  return /\.(md|markdown|html|htm|mmd|mermaid)$/i.test(path);
}

export async function createPreviewDocument(text: string, path: string, colors: { background: string; text: string; muted: string; accent: string; line: string; dark: boolean }, isCurrent: () => boolean = () => true): Promise<string> {
  const isMarkdown = /\.(md|markdown)$/i.test(path);
  const isMermaid = /\.(mmd|mermaid)$/i.test(path);
  const html = isMermaid ? "" : isMarkdown ? marked.parse(text, { async: false }) : text;
  const sanitized = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "base", "meta", "link", "form"],
    FORBID_ATTR: ["srcdoc", "autofocus"]
  });
  const preview = new DOMParser().parseFromString(sanitized, "text/html");
  if (isMermaid) {
    const pre = preview.createElement("pre");
    const code = preview.createElement("code");
    code.className = "language-mermaid";
    code.textContent = text;
    pre.append(code);
    preview.body.append(pre);
  }
  const diagrams = [...preview.querySelectorAll("pre > code.language-mermaid")];
  for (const [index, code] of diagrams.entries()) {
    if (!isCurrent()) return "";
    try {
      if (index >= 20) throw new Error("Only the first 20 diagrams are rendered in one preview.");
      if ((code.textContent || "").length > 50000) throw new Error("This diagram exceeds the 50,000-character preview limit.");
      diagramModule ||= import(mermaidUrl);
      const { renderDiagram } = await diagramModule;
      if (!isCurrent()) return "";
      const svg = await renderDiagram(code.textContent || "", colors.dark);
      const image = preview.createElement("img");
      image.className = "mermaid-diagram";
      image.alt = "Mermaid diagram";
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      code.parentElement!.replaceWith(image);
    } catch (error) {
      const message = preview.createElement("p");
      message.className = "mermaid-error";
      message.textContent = `Diagram could not be rendered: ${error instanceof Error ? error.message : String(error)}`;
      code.parentElement!.before(message);
    }
  }
  const policy = preview.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
  preview.head.prepend(policy);
  const style = preview.createElement("style");
  style.textContent = `
    :root { color-scheme: ${colors.dark ? "dark" : "light"}; }
    body { margin: 24px; background: ${colors.background}; color: ${colors.text}; font: 16px/1.6 system-ui, sans-serif; overflow-wrap: anywhere; }
    a { color: ${colors.accent}; }
    .mermaid-diagram { display: block; max-width: 100%; height: auto; margin: 20px auto; }
    .mermaid-error { padding: 12px; border: 1px solid ${colors.line}; white-space: pre-wrap; }
    ${isMarkdown ? `
    body { max-width: 900px; margin: 24px auto; padding: 0 24px; }
    h1, h2, h3 { line-height: 1.25; margin-top: 1.4em; }
    h1, h2 { border-bottom: 1px solid ${colors.line}; padding-bottom: .3em; }
    pre { padding: 14px; border: 1px solid ${colors.line}; border-radius: 6px; overflow: auto; }
    code { font: .9em ui-monospace, monospace; }
    :not(pre) > code { background: ${colors.line}; padding: .15em .3em; border-radius: 3px; }
    blockquote { margin-left: 0; padding-left: 16px; border-left: 4px solid ${colors.line}; color: ${colors.muted}; }
    table { border-collapse: collapse; display: block; overflow: auto; }
    th, td { border: 1px solid ${colors.line}; padding: 6px 12px; }
    img { max-width: 100%; }
    hr { border: 0; border-top: 1px solid ${colors.line}; }
    ` : ""}
  `;
  // Defaults precede author styles so HTML documents retain their own styling.
  policy.after(style);
  return `<!doctype html>${preview.documentElement.outerHTML}`;
}
