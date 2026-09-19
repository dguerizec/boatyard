# File Editor

Choose **File Editor** in a project's pane selector. The project must have a local source directory. Enter a project-relative path and press Enter, or click the **Browse project files** folder-tree icon in the pane toolbar to open the project file browser on the left. Expand a folder and click a file to open it. Click the icon again to hide the browser.

Each pane displays one file. Split the layout to keep several files visible. Opening a different file preserves the previous unsaved draft; **Drafts** toggles the list of drafts for the current project and stays highlighted while it is displayed. The pane restores its last file when reopened. Drafts are stored locally in the application's browser storage, including file contents; clearing that storage deletes them. A storage error is shown if a draft cannot be persisted.

- Drag the boundary between the browser and editor to resize it, or focus the boundary and use the left/right arrow keys. The browser width and visibility are remembered per pane. **Refresh** reloads the folder listing; large folders offer **Load more**. Hidden files are included, while broken links and links outside the project are disabled.
- **Save** or **Ctrl/Cmd+S** writes the file. Editing can continue during a save.
- The **Preview** eye icon in the pane toolbar toggles a rendered view of the current Markdown, HTML, or Mermaid draft, without saving. Click it again to return to the editor with the draft intact. It is disabled for other file types.
- **Find** or **Ctrl/Cmd+F** opens CodeMirror's search and replace panel. **Find** stays highlighted while the panel is open; click it again to close the panel.
- Undo/redo, line numbers, bracket matching, indentation, and selection are provided by CodeMirror.
- JavaScript, TypeScript, JSX/TSX, JSON, CSS, HTML, Markdown, and Python have syntax highlighting. Other UTF-8 files can be edited as plain text.
- The editor follows Boatyard's light or dark theme.

Visible documents are checked for disk changes every three seconds and when the window regains focus. Clean documents reload automatically. Dirty documents retain the draft and display the disk version for comparison. Choose **Use disk version** to discard the draft after confirmation, or **Keep my version** to accept the compared disk revision before explicitly saving your draft. Every save checks the revision again, including after conflict resolution. A deleted or inaccessible file leaves the draft available; saving requires the file to exist and be writable again.

This first version edits existing UTF-8 text files up to 2 MiB inside the project. It preserves a UTF-8 BOM, uniform LF/CRLF line endings, and file permission bits. Mixed line endings may be normalized on editing. Symlinks must resolve inside the project; files with multiple hard links cannot be saved. Saves use a temporary sibling and rename, with content checks before replacement; this is optimistic conflict detection, not a filesystem lock against other applications. It does not yet provide file creation, Git diffs, or language-server completion.

## Preview

Markdown previews support headings, emphasis, lists, tables, and code blocks, including rendered `mermaid` fences. Standalone `.mmd` and `.mermaid` files render as diagrams. The diagram engine loads on demand and follows the selected theme; invalid diagrams display an error with their source so editing can continue. Each preview renders up to 20 diagrams, with at most 50,000 characters and 500 edges per diagram. HTML previews retain inline styles and embedded style sheets. Both use an isolated, sanitized document with scripts, forms, and external resources disabled. Images and fonts embedded as data URLs can render; linked images, scripts, and style sheets are not loaded in this first version. HTTP(S) links open in the external browser; relative file links open through the editor's project file access rules.

The preview follows the selected theme and reflects changes to the current document. Find is disabled while previewing; return to the editor to search or replace text.
