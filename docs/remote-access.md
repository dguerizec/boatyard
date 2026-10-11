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
  Its dialog lets you name and add clients, copy their one-use links, see whether
  they are invited, signed in or connected, and revoke an individual client.
  Connected clients show **Direct** or **Relayed**, based on their selected
  WebRTC candidate pair. The route refreshes every three seconds; until it is
  known, the dialog shows **Checking connection…**.
  **Add client** starts Share if needed. Unnamed clients receive sequential names
  such as **Viewer 1** and **Viewer 2**. **Stop sharing** revokes all Share access
  while leaving Remote running.

Both dialogs open below their toolbar button. **Server settings** opens the
Remote access section of global settings for port and external URL configuration.

**Global settings → Remote access** contains settings for both servers:

- **Enable Remote** starts Remote now and automatically with Boatyard. Share
  starts only when its first client is added, and stays stopped after a restart.
  Its settings have no standalone Start or automatic startup control.
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

Each Share client gets a separate link, valid for 15 minutes and consumed by the
first browser that signs in. Adding another client does not invalidate existing
invitations. Revoking a client invalidates its invitation and browser session and
ends its stream. Disconnecting viewers keeps Share running so they can reconnect
with the same browser session. **Stop sharing** explicitly closes the session
and revokes all access. Removing its last client also stops Share. Links are kept
only in memory and remain available in the Share pane or dialog until they are
consumed, revoked, or Boatyard exits; the private code is omitted from visible
link text so existing spectators
cannot read it in the shared video, but **Copy URL** copies the complete link.

The client removes the URL fragment before redeeming the link. Loading the page
without running the client does not consume it. After a restart, add clients
again to start Share and generate new links.

Settings are shared across Boatyard profiles and saved in the configuration
root's `remote.json` (Remote) and `remote-share.json` (Share). Only a salted scrypt
password verifier is stored for Remote, with owner-only file permissions. Passwords and verifiers are not returned to the
settings renderer or printed in connection URLs.

Launch the checkout with `make run`; it uses the saved remote settings.
Remote access is disabled until configured.

## Connect

Open a displayed URL from another device, such as `http://192.0.2.10:47831`.
For full access, enter the password. For read-only access, open a generated
one-use link without a password prompt. A single available window connects
automatically; with multiple windows, choose the shared window and connect.
The browser keeps an HttpOnly, SameSite session
cookie for up to twelve hours. **Sign out** revokes it and ends that browser's
stream. Disconnecting or reloading preserves access in the same browser until
expiry or sign-out; the consumed URL cannot authenticate another browser. Server
restart or settings changes invalidate sessions for that server. Remote and Share
use separate cookies, including when both are accessed through the same LAN host.

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
The installed app opens the root address, without retaining private invitation
codes. Its usual password or browser-session authentication still applies.

Clients check for changed client assets when disconnecting from the stream and
before connecting again. A changed version reloads the page automatically between
sessions; updates never interrupt an active stream. Updates become available
after rebuilding Boatyard; unchanged builds do not cause reloads. Files are served
without browser caching, and no offline cache stores video or credentials.
Remote browser authentication survives server and Boatyard restarts until
explicit sign-out or a password change. Only session-token hashes are stored in
`remote-sessions.json`, with private file permissions. Cookies are renewed on
authenticated requests; browser storage limits and clearing site data still apply.
Share authentication lasts until sign-out, client revocation, or stopping Share;
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
