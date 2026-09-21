# Mermaid Preview Demo

Open this file in **File Editor**, then click **Preview** to render the diagrams.
Edit a label and reopen the preview to see your unsaved changes.

## Editing workflow

```mermaid
flowchart LR
    A[Open a project file] --> B[Edit the draft]
    B --> C{Preview supported?}
    C -->|Markdown, HTML or Mermaid| D[Open Preview]
    C -->|Other text files| B
    D --> E[Return to the editor]
    E --> B
    B --> F[Save the file]
```

## Draft preview

```mermaid
sequenceDiagram
    actor User
    participant Editor
    participant Preview
    participant Disk
    User->>Editor: Open a file
    Editor->>Disk: Read the file
    Disk-->>Editor: Text and revision
    User->>Editor: Edit the draft
    User->>Editor: Click Preview
    Editor->>Preview: Render the current draft
    Preview-->>User: Show the rendered document
    Note over Editor,Disk: Preview does not save the file
    User->>Editor: Click Preview again
    Editor-->>User: Restore the editing view
```

## Handling external changes

```mermaid
stateDiagram-v2
    [*] --> Saved
    Saved --> Modified: Edit locally
    Saved --> Saved: Reload an external change
    Modified --> Saved: Save successfully
    Modified --> Conflict: Detect an external change
    Conflict --> Saved: Use the disk version
    Conflict --> Modified: Keep the local draft
```

## Markdown formatting

The preview should also render **bold text**, *emphasis*, `inline code`, and tables.

| Format | Expected preview |
| --- | --- |
| Markdown | Formatted text and diagrams |
| HTML | Static content with embedded styles |
| Mermaid | A standalone diagram |

> Try both light and dark themes, and resize the pane to check the diagrams.
