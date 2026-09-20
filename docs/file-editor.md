# File Editor

Choose **File Editor** in a project's pane selector. The project must have a local source directory. Use **Open files** in the pane toolbar to select one or more files in the native file picker, including files outside the project, or click the **Browse project files** folder-tree icon in the pane toolbar to open the project file browser on the left. Expand a folder and click a file to open it. Click the icon again to hide the browser.

Each pane keeps its opened files in a horizontally scrollable tab strip. Click a tab to switch files; opening an already opened file selects its existing tab. Identical filenames show their paths to distinguish them. Modified files display a dot. Close a tab with its close icon, middle-click, or Delete while the tab has focus; modified tabs ask whether to **Save**, **Discard changes**, or **Cancel**. Save closes the tab only after a successful save; discarding also removes the local draft and reverts the shared changes. Linked panes close the tab together after this decision. Arrow keys and Home/End navigate the tabs. Closing the active tab selects its neighbor; closing the last tab leaves the pane empty. Split the layout to keep several files visible at once. Opening a different file preserves the previous unsaved draft. Drafts are saved automatically for recovery after an unexpected shutdown; restored tabs recover their modifications and show the modified-file dot. The pane restores its open tabs, selected file, and Preview mode when reopened or after an application restart. Each file remembers its cursor, selection, editor scroll position (both axes), and preview scroll position separately in each pane. Preview remains enabled when switching files. Files without a rendered preview use a read-only text or Hex view, including files loaded in blocks. Drafts are stored locally in the application's browser storage, including file contents; clearing that storage deletes them. A storage error is shown if a draft cannot be persisted.

- Drag the boundary between the browser and editor to resize it, or focus the boundary and use the left/right arrow keys. The browser width and visibility are remembered per pane. **Refresh** reloads the folder listing; large folders offer **Load more**. Hidden files are included, while broken links and links outside the project are disabled.
- **Save** or **Ctrl/Cmd+S** writes the file. Editing can continue during a save for files loaded in full; block edits pause until their save and reindex finish.
- The **Preview** eye icon in the pane toolbar toggles a rendered view of the current Markdown, HTML, or Mermaid draft, without saving. Click it again to return to the editor with the draft intact. It is disabled for other file types.
- **Find** or **Ctrl/Cmd+F** opens CodeMirror's search and replace panel. **Find** stays highlighted while the panel is open; click it again to close the panel.
- Undo/redo, line numbers, bracket matching, indentation, and selection are provided by CodeMirror.
- JavaScript, TypeScript, JSX/TSX, JSON, CSS, HTML, Markdown, Python, and TOML (`.toml`) have syntax highlighting. Docker build files are recognized as `Dockerfile`, `Containerfile`, variants such as `Dockerfile.dev`, and files ending in `.dockerfile` or `.containerfile`. Other UTF-8 files can be edited as plain text.
- The editor follows Boatyard's light or dark theme.

## Vim mode

Click **Vi** in the pane toolbar to toggle Vim keybindings. The highlighted button
means Vim is enabled; click it again to return to standard editing. This preference
is remembered per pane. In **Settings → Plugins → File Editor**, set **Vim mode
by default** to **Enabled** to start panes in Vim when they have no saved Vi
preference. The default is **Disabled**; an explicit choice with the pane button
takes precedence. Changes to the default apply when an editor pane is opened
again. Switching modes preserves the draft, cursor, and undo
history. Vim applies to the text editor, including inline Git diffs; Hex and
rendered previews retain their own controls.

The editor's Vim status bar shows **NORMAL**, **INSERT**, or **VISUAL** and accepts
searches and Ex commands. Start with `h/j/k/l` for movement, `i` to insert, Escape
to return to Normal, `v` for Visual selection, `dd` to delete a line, `yy`/`p` to
copy/paste, `/` to search, and `u`/`Ctrl+R` to undo/redo. The keybindings come from
`@replit/codemirror-vim`; this is Vim emulation, not a full Vim/Neovim runtime.

Use `:w` or `:write` to save the current file through Boatyard's usual revision
checks and conflict handling. Save errors remain visible in the editor status.
Write ranges, file arguments, and `:w!` are unsupported; use the existing conflict
controls when a file changes on disk.

- `:q` / `:quit` closes the current tab only if it has no unsaved changes.
- `:wq` saves and closes the current tab after a successful save. Conflicts, save
  failures, or new edits during the save leave the tab open.
- `:q!` / `:quit!` discards the draft and closes without confirmation. As with
  **Discard changes** in the tab dialog, this reverts the shared draft in other
  panes displaying the file. Linked panes also follow tab closure.

These commands close a file tab, not the pane or application. Closing the last
file leaves an empty pane. Close commands do not accept ranges or filenames;
`:wq!` is unsupported and cannot bypass conflict checks.

For paged files, Vim motions and searches operate on the loaded block;
undo/redo uses the shared file-wide history and saving writes all modified blocks.

## Saving and disk changes

Visible documents are checked for disk changes every three seconds and when the window regains focus. Clean documents reload automatically. Dirty documents retain the draft and display the disk version for comparison. Choose **Use disk version** to discard the draft after confirmation, or **Keep my version** to accept the compared disk revision before explicitly saving your draft. Every save checks the revision again, including after conflict resolution. A deleted or inaccessible file leaves the draft available; saving requires the file to exist and be writable again.

Existing files inside or outside the project can be edited using text or Hex mode. Files larger than 2 MiB are loaded in indexed blocks. It preserves a UTF-8 BOM, uniform LF/CRLF line endings, and file permission bits. Mixed line endings may be normalized on editing. Relative paths and browser entries stay inside the project; external files selected in the native picker retain their absolute paths. External paths are preserved in drafts, linked panes, and restored views. Symlinks opened through an absolute path resolve to their canonical target; files with multiple hard links cannot be saved. Saves use a temporary sibling and rename, with content checks before replacement; this is optimistic conflict detection, not a filesystem lock against other applications. It does not yet provide file creation or language-server completion.

## Preview

Drag the **Preview** eye icon from an editor's pane toolbar onto another pane to open the file in a **File Editor** with Preview enabled. Click the target pane’s Preview icon to return to editing; all editor controls remain available. Available panes display drop targets, and the hovered target is highlighted. Dropping replaces the target pane's content; the source editor stays open. The panes are linked after the drop: the target adopts the source pane's complete tab list and order. Opening, selecting, or closing a tab in either pane updates every linked pane, including closing the last tab. Each pane keeps its own view mode and scroll position. Unsaved edits remain shared. A **Link** icon appears in both toolbars; hover or focus it to highlight the linked panes, and click it to unlink file navigation while keeping the current files open. Links survive reopening and application restarts. Drag another file's Preview icon onto the preview pane to replace it. The preview's file and scroll position survive reopening and application restarts.

Markdown previews support headings, emphasis, lists, tables, and code blocks, including rendered `mermaid` fences. Standalone `.mmd` and `.mermaid` files render as diagrams. The diagram engine loads on demand and follows the selected theme; invalid diagrams display an error with their source so editing can continue. Each preview renders up to 20 diagrams, with at most 50,000 characters and 500 edges per diagram. HTML previews retain inline styles and embedded style sheets. Both use an isolated, sanitized document with scripts, forms, and external resources disabled. Images and fonts embedded as data URLs can render; linked images, scripts, and style sheets are not loaded in this first version. HTTP(S) links open in the external browser; relative file links open through the editor's file access rules.

The preview follows the selected theme and reflects changes to the current document. Find is disabled while previewing; return to the editor to search or replace text.

## Images

Open PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, or SVG files from the file browser or native file picker to view them in the same File Editor pane. Images fit inside the pane; their dimensions and file size appear in the status bar. The image view does not edit pixels directly; Hex mode can edit image bytes, using indexed blocks for large images. Images up to 20 MiB can be viewed. SVG files render as images, without executing scripts. Image navigation also follows pane links, and switching back to a text file preserves its draft. The last opened image is restored after reopening the pane.

## Hex editing

Drag the **Hex editor** icon onto another pane to open a linked File Editor in Hex mode. Drop targets highlight as with Preview and Git diff. The panes share their tabs and selected file while keeping their own view modes. Linked text and Hex panes also share the cursor and selection. Byte positions account for UTF-8 characters, BOMs, and CRLF line endings; partial-character byte selections expand to whole characters in text. The receiving pane scrolls only as needed to reveal the active end, without taking focus. Manual scrolling remains independent. Hex supports Shift-click, Shift with navigation keys, and dragging across byte cells to select a range. For large text files, the receiving pane loads the block containing the active end and displays the part of the selection within that block.

The **Hex editor** binary icon in the pane toolbar switches between text editing and hexadecimal byte editing. Files that are not UTF-8 text open in Hex automatically. Hex shows offsets, sixteen bytes per row, and an ASCII column in a continuous, virtualized scroll view. Only visible rows and a small margin are rendered. The scrollbar spans the complete file; blocks are loaded on demand into a bounded cache. Enter any absolute hexadecimal offset and click Go to jump there. The scroll position is remembered per file and pane. Arrow keys move between bytes. Enter two hexadecimal digits to replace a byte, or paste complete byte pairs to overwrite a range. This version overwrites bytes without inserting or deleting them.

Text, Hex, and Preview use the same unsaved document. Hex preserves exact bytes, including BOMs and line endings; returning to text requires valid UTF-8 without NUL bytes. The Preview icon renders supported documents and images using their current draft bytes. Save or Ctrl/Cmd+S writes the bytes using the same revision and project-boundary checks as text saves. Hex has Undo/Redo buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y shortcuts. Binary drafts and the selected Hex mode are restored locally after reopening. Find is available in text mode.

## Large files

The first open scans the complete file using bounded buffers and builds an index of blocks up to 2 MiB. Text boundaries never split a UTF-8 code point or a CRLF pair. Each block records its byte range, Unicode code point count, UTF-16 unit count, line-break count, cumulative offsets, and whether it continues the previous line. The index is cached in memory and in the plugin data directory; the cache contains metadata and hashes, not file contents. A change to the file's identity, size, or modification/change timestamps invalidates it.

**Previous block**, **Next block**, and **Go to block** navigate in text mode; Hex mode hides these controls and scrolls continuously. Text mode also provides a scrollbar for the complete file, weighted by indexed line counts. Long lines that cross a block boundary appear as consecutive fragments with the same logical line number. The current block, cursor, and scroll positions are remembered per pane. Find operates on the loaded block. Undo/Redo follows the file-wide edit history across blocks. Syntax highlighting and document Preview are disabled for paged files.

Large files use one shared changeset in Text and Hex modes. Edit several blocks without saving between them: modified byte ranges are kept separately from the read cache and reapplied when a block is loaded. Text insertions and deletions use original-file coordinates, so subsequent byte offsets and line counts follow the unsaved changes. Undo/Redo crosses block boundaries and returns to the affected block. The session history keeps up to 100 changes within a bounded history budget; saved drafts retain the changeset, not Undo/Redo history.

**Save** writes every modified range in a single atomic replacement. It streams untouched ranges, checks the complete original revision and the bytes being replaced, then rebuilds the index. Editing pauses across linked panes during that save. A failed save retains the whole changeset. Disk conflicts keep it intact for comparison; **Keep my version** explicitly rebases modified ranges onto the compared revision when the file size and affected block boundaries are unchanged, while **Use disk version** discards the entire file's changeset after confirmation.

Changesets are stored as local drafts per file and shared by linked panes. The original file must remain available to reconstruct untouched content. A storage error blocks navigation that would lose an unpersisted draft. Hex pastes currently must fit inside the active edit block. Memory holds active edit blocks, sparse changed ranges, bounded history, and a bounded Hex read cache.

## Git changes

The file browser displays Git status badges and marks folders containing changes.
The **Changes** filter lists modified, staged, untracked, renamed, conflicted, and
removed files; each entry has an **Open diff** action. Status badges describe the
index and working tree, while unsaved editor drafts remain separate until saved.

Text editors show clickable Git gutter markers for added, modified, and deleted
lines. The **Git diff** toolbar icon toggles an editable inline comparison of
**HEAD → current content**, including unsaved drafts, inside the original text
editor. Added and replacement lines remain editable on a green background. Old
lines are folded by default: a gutter chevron expands them as red, read-only
blocks. Collapsed blocks occupy no additional text rows. Old lines are display
widgets and never enter the saved document, clipboard selections of the current
text, or Undo/Redo history. The original editor, cursor, search, and editing
history remain available when toggling Diff.

**Previous change** and **Next change** navigate between changed regions. Drag
the Diff icon to another pane to create a linked inline editor, using the same
link/unlink controls as Preview. Both panes share the current draft. The Diff
mode is remembered per pane; original lines start folded when reopening a file.

Untracked files use an empty baseline. Repositories without a first commit also
use an empty baseline. Staged renames compare against the original HEAD path.
Deleted files open as read-only diffs from the Changes list; existing text drafts
are retained and shown instead of an empty current version. External files use
their own enclosing Git working tree. Git failures are shown without replacing
or discarding drafts. No staging, unstaging, or Git writes occur in this mode.

This first version compares complete UTF-8 text files: paged files, binary files,
and HEAD versions larger than 2 MiB display an explicit unavailable message.
Line endings are normalized for the visual comparison. Expensive comparisons may
use a simplified diff, identified in the view. Git metadata refreshes with the
editor polling cycle and window focus; requests are shared between panes.
