# File Editor

Choose **File Editor** in a project's pane selector. The project must have a local source directory. Enter a project-relative path and press Enter, or use **Browse…** to select an existing file inside that directory.

Each pane displays one file. Split the layout to keep several files visible. Opening a different file preserves the previous unsaved draft; **Drafts** toggles the list of drafts for the current project and stays highlighted while it is displayed. The pane restores its last file when reopened. Drafts are stored locally in the application's browser storage, including file contents; clearing that storage deletes them. A storage error is shown if a draft cannot be persisted.

- **Save** or **Ctrl/Cmd+S** writes the file. Editing can continue during a save.
- **Find** or **Ctrl/Cmd+F** opens CodeMirror's search and replace panel. **Find** stays highlighted while the panel is open; click it again to close the panel.
- Undo/redo, line numbers, bracket matching, indentation, and selection are provided by CodeMirror.
- JavaScript, TypeScript, JSX/TSX, JSON, CSS, HTML, Markdown, and Python have syntax highlighting. Other UTF-8 files can be edited as plain text.
- The editor follows Boatyard's light or dark theme.

Visible documents are checked for disk changes every three seconds and when the window regains focus. Clean documents reload automatically. Dirty documents retain the draft and display the disk version for comparison. Choose **Use disk version** to discard the draft after confirmation, or **Keep my version** to accept the compared disk revision before explicitly saving your draft. Every save checks the revision again, including after conflict resolution. A deleted or inaccessible file leaves the draft available; saving requires the file to exist and be writable again.

This first version edits existing UTF-8 text files up to 2 MiB inside the project. It preserves a UTF-8 BOM, uniform LF/CRLF line endings, and file permission bits. Mixed line endings may be normalized on editing. Symlinks must resolve inside the project; files with multiple hard links cannot be saved. Saves use a temporary sibling and rename, with content checks before replacement; this is optimistic conflict detection, not a filesystem lock against other applications. It does not yet provide file creation, a directory tree, Git diffs, or language-server completion.
