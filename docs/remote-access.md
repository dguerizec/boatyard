# Boatyard Remote

Boatyard serves a browser client and streams one selected workspace window over
WebRTC. No client installation or separate remote desktop server is required.
Capture and control stay inside the selected Boatyard window.

## Configure and start

**Remote** and **Share** have independent servers and can run simultaneously.
Each toolbar button has a red border while its server is waiting for connections.
When users connect, it turns red and displays the connected user count in place
of its label, keeping the same width. Stopping the server restores its normal appearance.

- **Remote** provides full mouse and keyboard control to one client. Its dialog
  lets you set the password and start or stop the server.
  Leaving the password blank retains the existing password.
- **Share** is always read-only and accepts up to eight simultaneous viewers.
  Its dialog lets you name and add clients, copy their reusable links or
  six-digit personal codes, see whether they are invited, signed in or connected, and revoke an individual client.
  Connected clients show **Direct** or **Relayed**, based on their selected
  WebRTC candidate pair. The route refreshes every three seconds; until it is
  known, the dialog shows **Checking connection…**.
  **Add participant** starts Share if needed. The host may prefill a name, or leave
  it for the participant to enter before joining. **Stop sharing** revokes all Share access
  while leaving Remote running.

The Share dialog and Share pane open on **Session**, with connected participants,
join approvals and live connection status. **Setup** contains start/stop
controls, joining options, participant creation, and invitation links and codes,
including invitations for participants already connected. **Shared projects**
controls which projects may be shown. Switching tabs preserves invitation drafts.

The **Session** tab includes **Hide screen / Show screen**. Press
**Ctrl+Shift+S** anywhere in a Boatyard window, including embedded web apps, to
toggle it. Hiding sends black video while preserving connections, invitations,
viewers' crops and viewer access. The browser overlays the Boatyard illustration,
waiting text and animated dots while black video continues decoding behind it.
The overlay disappears with the first visible frame, without reconnecting. The
same illustration and animation appear during connection and recovery until the
first frame arrives. It does not affect Remote.

Expand **Shared projects** to choose the projects viewers may see. Projects are
private by default, including projects added later. Only the workspace view of a
checked project is visible; other projects, the global workspace and settings or
project forms send black video. Switching back to a checked project resumes video
unless **Hide screen** is active. The selection and hide state are saved across
restarts, independently for each configuration context.

Both dialogs open below their toolbar button. **Server settings** opens the
Remote access section of global settings for port and external URL configuration.

**Global settings → Remote access** contains settings for both servers:

- **Enable Remote** starts Remote now and automatically with Boatyard. Share
  can be started from its sidebar or by adding a participant or enabling a joining
  option. Both servers restore their enabled state when Boatyard restarts.
- **Port** defaults to `47831` for Remote and the following port
  (`47832` in a fresh configuration) for Share. The two servers must use different
  ports when enabled together.
- **External URL** is an optional root HTTP/HTTPS address of a reverse proxy or
  tunnel. Leave blank for direct LAN access. Paths are not supported. When both
  servers are enabled, use distinct external origins, for example
  `https://remote.example.com` and `https://share.example.com`, routing each to
  its corresponding local port. Configure these routes in your reverse proxy or
  tunnel service.

**Save and apply** restarts Remote if enabled, or saves Share settings and stops
sharing until another client is added. **Start** saves and enables Remote;
**Stop** disables the chosen server. Changes to one server do not interrupt the
other. Connection addresses use a dropdown; **Open** and **Copy URL** use its
selected address.

Each Share participant has a reusable six-digit personal code, displayed as
**123 456** in the browser, and a link carrying that code in its URL fragment.
Codes accept spaces or hyphens and survive Boatyard restarts until revoked or
explicitly invalidated with **Stop sharing**.
Names are required before joining. A name already associated with a personal
code is prefilled and can be confirmed or edited. Names do not identify access:
participants with the same name still have distinct personal codes.

Opening a link preloads the join form; only explicitly pressing **Join** takes
over access. Joining with the same personal code from a second device immediately
invalidates the old browser authentication and closes its stream, including an
in-progress setup. The participant identity and viewer access remain. The previous device must explicitly
join again and cannot reclaim access through automatic recovery or a page reload.
The browser's **Your personal access code** button shows the code and offers
**Copy code** and **Copy link** for moving to another device.

The host can always copy an existing participant's link or code again, including
while they are connected. Codes are stored in the private Share access file and
omitted from visible host link text, keeping them out of shared video. **Copy URL**
includes the full link;
**Copy code** copies the digits formatted as two groups of three.
Revoking a participant invalidates their code and browser authentication and ends
their stream. Disconnecting or signing out preserves their personal code.
**Stop sharing** invalidates personal codes and rotates the group code, while
keeping the joining options. Quitting Boatyard or applying Share server settings
ends requests and browser authentication but preserves invitations and joining
options. If Share was enabled when Boatyard quit, it resumes automatically;
participants can join again with their existing codes.
Removing the last participant also stops Share unless group entry or join
requests remain enabled.

**Joining options**, always visible above participant creation in **Setup**, offers
two exclusive admission paths. Enabling one disables the other; personal invitations
remain available in either mode. The group-code and approval switches share one row.

- **Group code** creates one reusable code/link to distribute to a group.
  Each visitor enters their own name and receives a distinct personal code.
  **Require approval**, enabled by default and persisted with joining options,
  makes these visitors wait for the host. The host may disable it for immediate group entry.
  Disabling the group code prevents further entry without revoking personal codes.
- **Ask to join without a code** lets a visitor enter their name and request
  access from the base Share address. The host receives a desktop notification
  when supported, and the Share button shows a pending-request badge. The Share
  pane and dialog offer **Accept** and **Decline** for each named request.
  Acceptance creates the personal access; waiting visitors cannot access windows
  or stream before approval. Requests expire after ten minutes and can be cancelled.
  Reloading the same tab resumes its pending request without creating another.

Enabling either admission path starts Share if needed. These options and all
access codes are scoped to the current sharing session. Failed code attempts,
request creation and total admission traffic are bounded and rate limited.
The browser removes invitation fragments before looking up the code. Loading
only the HTML, such as a link preview, does not join or take over access.

Settings are shared across Boatyard profiles and saved in the configuration
root's `remote.json` (Remote) and `remote-share.json` (Share). Only a salted scrypt
password verifier is stored for Remote, with owner-only file permissions. Passwords and verifiers are not returned to the
settings renderer or printed in connection URLs.

Launch the checkout with `make run`; it uses the saved remote settings.
Remote access is disabled until configured.

## Session chat

The Share browser has a **Chat** toolbar button with an unread-message badge.
On desktop, chat opens beside the video; on narrow screens, it temporarily takes
its place and can be closed to return to the video. The operator uses the **Chat**
tab in the Share pane or dialog. Everyone in the current sharing session sees the
same conversation, including its full history when joining later or reconnecting.
There are no private messages or reply threads.

Messages support plain text, clickable HTTP/HTTPS links and one image. Paste a
screenshot into the message field or use **Attach image** to choose a PNG, JPEG
or WebP file (up to 5 MB). Review the preview before sending, or remove it.
**Enter** sends; **Shift+Enter** inserts a new line. Click an image thumbnail to
enlarge it. Chat does not capture screenshots or request screen access.

Each message shows its author and a compact local-time timestamp; hover over the
time for the full date and time. Date separators keep longer histories readable.
The operator can delete any message using its visible trash icon. Deletion removes
it from every participant's view and the stored archive, including its image.

Each Share server start creates a new conversation. Stopping Share or quitting
Boatyard ends it without deleting its messages. The operator's conversation selector
provides read-only access to earlier sessions, with deletion still available.
Archives and images are stored locally under `share-chat/` in the configuration
root, and survive application restarts. Participants cannot access older sessions.
The current conversation allows up to 5,000 messages and 200 MB of images; reaching
a limit reports an error and preserves the existing history.

## Connect

Open a displayed URL from another device, such as `http://192.0.2.10:47831`.
For full access, enter the password. For Share, enter your personal or group
code and your name, or select the separate **Ask to join** path if the host
allows requests. The request path only asks for your name. The browser remembers
your entered name in localStorage for later visits; a name associated with a
personal code takes priority when that code is looked up.
A generated link preloads the code and any associated name. After joining,
a single available window connects automatically; with multiple windows,
choose the shared window and connect.
The browser keeps an HttpOnly, SameSite cookie. **Sign out** invalidates that
browser's authentication and ends its stream; a Share participant can use their
personal code to join again. Disconnecting or reloading preserves active browser
access. Remote and Share use separate cookies, including when both are accessed
through the same LAN host. Share authentication ends when sharing stops or the
personal code is used on another device. Remote authentication persists across
restarts unless signed out or the password changes.

The listener binds to `0.0.0.0`. The advanced environment override
`BOATYARD_REMOTE_HOST=127.0.0.1` restricts it to loopback. The application accepts
its own interface IP addresses and the configured external host, with same-origin
checks on requests. Login attempts are rate limited.

For internet access, configure an HTTPS tunnel separately to forward to the
listening port and enter its root URL in **External URL**. HTTPS encrypts password
and session exchanges; a tunnel's own login can complement the application login.
Configure the tunnel and network firewall rules separately.

The HTTP endpoint carries assets and offer/answer signaling. WebRTC carries video
and controls directly, or through TURN when configured. Advanced ICE configuration
remains available at launch:

```sh
BOATYARD_REMOTE_ICE_SERVERS='[{"urls":"turn:turn.example.com:3478","username":"example","credential":"temporary-credential"}]' make run
```

ICE settings go to authenticated clients. Without ICE servers, the initial setup
targets local networks. A tunnel serving the webapp does not itself relay media.

### WebRTC connectivity

Open **Settings → Remote access → WebRTC connectivity**. Remote and Share use
one installation-wide provider. New installations default to **Direct only**,
with no TURN relay or dedicated STUN server. A web tunnel does not relay media;
connections can fail depending on the networks involved.

- **Cloudflare TURN**: enter your own Realtime TURN key ID and key secret (not
  the API token used to manage tunnels). The main process requests temporary
  credentials; the permanent secret never reaches the streaming or remote browser.
- **Custom TURN server**: enter one or more `turn:` / `turns:` addresses and
  choose fixed username/password or temporary coturn credentials. Fixed credentials
  are sent to authenticated peers. For temporary credentials, configure coturn
  with `use-auth-secret` and the same shared secret; Boatyard generates expiring
  HMAC-SHA1 credentials in its main process. The shared secret stays private.

Settings are stored in private `webrtc.json` inside the configuration root.
Existing `cloudflare-turn.json` settings migrate automatically on first load;
the original file is retained as a private backup and is ignored once the new
file exists. No provider, private server or secret is bundled with Boatyard.
Blank secret fields preserve saved values. Changes apply to new connections;
existing sessions pick them up at their next credential renewal.
`BOATYARD_REMOTE_ICE_SERVERS` remains an advanced override and takes precedence;
the form explicitly indicates when it is active.

The custom TURN address list supports `#` comments, either on their own line or
after an address. Prefix an address with `#` to disable it temporarily. Comments
and blank lines are preserved when saving; only active addresses are sent to
WebRTC. A custom provider requires at least one active address.

By default, both peers allow direct connections with TURN fallback. Enable
**Force TURN relay** to require TURN on new Remote and Share connections. This
is useful for testing the complete relay path; connections fail if TURN is
unavailable instead of falling back to a direct route. Save, then disconnect and
reconnect the viewer. The policy stays unchanged during credential renewal for
an existing connection. Disable it to restore automatic route selection.

Dedicated STUN URLs and Cloudflare port 53 URLs are excluded. Temporary credentials last 12 hours;
connected viewers renew both peers with an ICE restart after ten hours, keeping
the stream session and camera. Renewal failures show a reconnect message rather
than silently falling back. New connections always obtain fresh credentials.

**Test saved connectivity** checks authenticated TURN relay allocation from the
local installation. It does not establish an end-to-end media path or prove
reachability from other networks. Validate those with an external Remote/Share
client. Live diagnostics show the selected Direct or TURN relay transport.

See [Cloudflare credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
and [coturn authentication](https://github.com/coturn/coturn/blob/master/README.turnserver).

## Viewer

The viewer can be installed as a standalone PWA from its HTTPS address. Chrome
offers **Install app** when installation is available; on iOS, use the browser's
Share menu and **Add to Home Screen**. Remote and Share origins install separately.
They install as **Boatyard Remote** (coral frame and pointer badge) and
**Boatyard Share** (blue frame and broadcast badge), using the official Boatyard
artwork. Browser tabs and Apple home-screen icons use the same mode-specific identity.
The installed app opens the root address, without retaining private invitation
codes. Its usual password or browser-session authentication still applies.

To regenerate the committed icon sizes from the official artwork and badge
definitions, run `npm run generate:remote-icons` with ImageMagick installed.
Normal builds use the committed PNG files and do not require ImageMagick.

Clients check for changed client assets when disconnecting from the stream and
before connecting again. A changed version reloads the page automatically between
sessions; updates never interrupt an active stream. Updates become available
after rebuilding Boatyard; unchanged builds do not cause reloads. Files are served
without browser caching, and no offline cache stores video or credentials.
Remote browser authentication survives server and Boatyard restarts until
explicit sign-out or a password change. Only session-token hashes are stored in
`remote-sessions.json`, with private file permissions. Cookies are renewed on
authenticated requests; browser storage limits and clearing site data still apply.
Share browser authentication lasts until sign-out, participant revocation,
use of the personal code on another device, or stopping Share;
stopping Share still invalidates its invitations and browser sessions.

Viewer commands use a single bottom toolbar with Lucide icons and labeled tooltips.
Connection messages appear centered in the video area. When disconnected, the
connection form reserves a row above the toolbar so its button remains accessible
even with diagnostics open. A single available window needs no selector.
On narrow screens, swipe the toolbar horizontally to reach every command.
The window selector and keyboard input open above the toolbar.

The initial **Fill** framing uses the entire viewer surface, adjusting the
transmitted crop to its proportions. **Fit** adjusts the camera once to show the
complete window and can introduce letterboxing when the window and device have different shapes. **Fullscreen**
uses the browser's fullscreen mode and highlights its button while active.
Fit and Fill are camera actions, so zooming and panning remain available after
either. All pointer coordinates account for the actual video placement and camera crop.
Zooming after Fit progressively fills letterboxed space before cropping on both
axes. Fill covers portrait and landscape viewers with a centered source crop.

Mouse movement pans the camera using Hugescreen's continuous
motion model. Approaching a viewer edge reveals the corresponding window edge;
stopping the pointer stops the camera. Automatic pan pauses during clicks,
dragging and touch gestures. Touch keeps explicit pan and pinch controls.

- Mouse: click, drag, wheel, keyboard shortcuts and text. **Alt+drag** pans the
  camera; **Alt+wheel** zooms it.
- Touch: one finger interacts; two fingers pan or pinch the camera, updating the
  transmitted crop during the gesture at up to 20 updates per second.
- Read-only: dragging pans the camera; the mouse wheel zooms without a modifier. Host
  input is blocked in the Electron main process even if a client bypasses its
  disabled controls.
- **Follow mouse** is enabled by default for Share, and disabled by default for
  Remote. It tracks the local pointer inside the shared window, keeping the current
  zoom and moving the crop to reveal the area being used. A pointer marker remains
  visible after Fit too. Following pauses remote mouse, keyboard and
  text input; the wheel and pinch gestures still zoom. Turning it off restores
  normal controls. The camera stays where it is when the local pointer leaves
  the shared window; desktop coordinates are not transmitted. Local pointer
  tracking requires desktop pointer access (X11/XWayland on Linux).
- Local mouse movement, clicks or key presses in the controlled Boatyard window
  automatically enable **Follow mouse** on Remote. Held remote buttons and keys
  are released before the local interaction, and remote input stays paused until
  the remote user explicitly turns Follow mouse off. Activity in other windows
  does not trigger this handover. An idle Remote viewer does not continuously
  resend its pointer position as video frames arrive.
- **Keyboard** opens mobile text entry with **Send** and **Enter**.
- **Disconnect** ends the stream while keeping the browser signed in.

The camera's pan and zoom do not move, resize or zoom the host application. One Remote controller and up to eight Share viewers can stream at once, each with
an independent camera. Boatyard uses a separate capture and encoder for
each connection, so resource and bandwidth use increase with the number of
viewers. Sharing capture work across connections remains a future optimization.

## Implementation and limits

The **Connection diagnostics** info button opens live measurements in the viewer.
It shows the selected Direct or TURN relay transport, network round-trip time,
captured-window and encoded-video dimensions, host rendering and encoding rates,
received frame rate, video buffer delay, and
decoding time. Rates and delays use recent sampling intervals, not lifetime
averages. Receiver statistics are sampled only while the panel is open.
Sent video dimensions come from the encoder statistics after cropping and scaling;
they include the small metadata footer removed from the displayed image.
Estimated frame age uses a timestamp embedded in the displayed frame's metadata
footer and a control-channel round trip to estimate the host/client clock offset.
It measures time since the canvas frame was created, excluding earlier desktop
capture delay. The estimate assumes roughly symmetric control-channel latency;
it remains available without optional browser capture timestamps and increases
when the displayed frame freezes. Missing browser statistics are displayed as
Unavailable. These values
help distinguish host encoding, network buffering, and client decoding problems;
they do not by themselves establish the cause of a stall.
The estimated video delay also remains visible in a translucent top-right overlay,
even with diagnostics closed. Receivers request the lowest supported jitter-buffer
target. Frame age never triggers an automatic transport replacement: a slow
but established stream stays connected so its delay can be measured.
An actual transport interruption can trigger authenticated HTTP recovery,
limited to one attempt per 30 seconds.
The participant identity and camera crop remain in place.
Failed recovery leaves the viewer disconnected.
The host keeps an interrupted transport for up to 15 seconds to accept recovery;
explicit disconnects and invitation revocation still close it immediately.
The diagnostics text can be selected and copied; the host packet queue measures
recent sender-side packet waiting time separately from the receiver video buffer.
When the browser exposes per-frame WebRTC timestamps, the panel also shows
capture-to-receive and receive-to-presentation delays, plus a browser frame-age
estimate independent of the footer clock. Receive-to-presentation includes
buffering, decoding and presentation callback scheduling; it is not an additional
network delay. Optional capture timestamps can be absent, particularly for canvas
sources, in which case those fields remain Unavailable.
The delay overlay updates twice a second without polling WebRTC
statistics, does not intercept input, and disappears when disconnected.

The main process owns settings, HTTP authentication and input routing. An isolated
sandboxed renderer owns native-window capture, a crop canvas and WebRTC. The
canvas crops before encoding, with a maximum image area of 1280 × 720 at a target
24 fps, with a 2.5 Mbps video ceiling and frame-rate adaptation under congestion,
plus a small transport-only metadata footer. Pending camera and pointer movement
updates retain only the latest position between clicks, keys or releases, so slow
input processing does not replay an accumulating history of motion. The viewer removes that
footer and uses its camera revision to associate each decoded frame with the
correct coordinates. The whole window is still captured locally: the crop reduces
transmitted pixels, not necessarily capture GPU work.

The sender removes native window chrome using the window's content bounds before
cropping. Captured pixels and mouse input share the same content origin, including
when the host has a visible menu bar or a non-default desktop scale factor.

Input targets the main renderer or the visible native web view under the pointer.
Dragging retains its original target; keyboard input follows the last clicked
visible target. Held input is released on blur, crop changes and shutdown.
Minimizing or resizing the host window ends sharing; reconnect for its new size.

Video and data have separate delivery timing. Inputs use the crop of the frame
actually displayed, with bounded crop history on the host. Mouse-down freezes
the camera until mouse-up, so an in-flight pan cannot split a click across crops.
Frames with unknown or damaged metadata keep the previous image visible.
Platform-specific capture, rapid camera changes and native
window decorations still need broader real-device validation. Keep the shared
window visible during initial trials. Full IME forwarding, clipboard,
files and native dialogs are not supported.
