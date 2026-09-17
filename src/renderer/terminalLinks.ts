import type { ILink, ITerminalAddon, Terminal } from "@xterm/xterm";
import type { WebLinksAddon } from "@xterm/addon-web-links";

// Adapt the standard URL detector through xterm's public link-provider API so
// decorations also react when Ctrl changes while the pointer stays still.
export function createTerminalLinksAddon(
  Addon: typeof WebLinksAddon,
  eventTarget: Window,
  openExternal: (url: string) => unknown
): ITerminalAddon {
  let hoveredLink: ILink | undefined;
  let ctrlPressed = false;
  const updateDecorations = () => {
    if (hoveredLink?.decorations) {
      hoveredLink.decorations.underline = ctrlPressed;
      hoveredLink.decorations.pointerCursor = ctrlPressed;
    }
  };
  const onModifier = (event: KeyboardEvent | MouseEvent) => {
    ctrlPressed = event.ctrlKey;
    updateDecorations();
  };
  const onBlur = () => {
    ctrlPressed = false;
    updateDecorations();
  };
  const addon = new Addon((event, url) => {
    if (!event.ctrlKey || event.button !== 0) {
      return;
    }
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      return;
    }
    event.preventDefault();
    Promise.resolve().then(() => openExternal(url)).catch((error) => {
      console.error("Could not open terminal link:", error);
    });
  });
  return {
    activate(term: Terminal) {
      eventTarget.addEventListener("keydown", onModifier);
      eventTarget.addEventListener("keyup", onModifier);
      eventTarget.addEventListener("mousemove", onModifier);
      eventTarget.addEventListener("blur", onBlur);
      addon.activate(new Proxy(term, {
        get(target, property) {
          if (property === "registerLinkProvider") {
            return (provider: import("@xterm/xterm").ILinkProvider) => target.registerLinkProvider({
              provideLinks(line, callback) {
                provider.provideLinks(line, (links) => {
                  for (const link of links || []) {
                    link.decorations = { underline: false, pointerCursor: false };
                    const { hover, leave, dispose } = link;
                    link.hover = (event, text) => {
                      hoveredLink = link;
                      onModifier(event);
                      // xterm installs reactive decoration setters after hover returns.
                      queueMicrotask(() => {
                        if (hoveredLink === link) updateDecorations();
                      });
                      hover?.(event, text);
                    };
                    link.leave = (event, text) => {
                      if (hoveredLink === link) hoveredLink = undefined;
                      leave?.(event, text);
                    };
                    link.dispose = () => {
                      if (hoveredLink === link) hoveredLink = undefined;
                      dispose?.();
                    };
                  }
                  callback(links);
                });
              }
            });
          }
          return Reflect.get(target, property, target);
        }
      }));
    },
    dispose() {
      eventTarget.removeEventListener("keydown", onModifier);
      eventTarget.removeEventListener("keyup", onModifier);
      eventTarget.removeEventListener("mousemove", onModifier);
      eventTarget.removeEventListener("blur", onBlur);
      hoveredLink = undefined;
      addon.dispose();
    }
  };
}
