import { createToolIcon } from './toolIcons.js';

/** One view implementation for the operator pane and standalone Share client. */
export function createShareChat(root, adapter) {
  root.classList.add('share-chat');
  root.innerHTML = `<label class="chat-archive" hidden>Conversation <select aria-label="Conversation history"></select></label>
    <p class="chat-status" role="status">Loading chat…</p><button class="chat-retry" type="button" hidden>Retry</button>
    <div class="chat-log" role="log" aria-label="Session messages" aria-live="off" tabindex="0"></div>
    <button class="chat-new" type="button" hidden>New messages ↓</button>
    <form class="chat-compose"><div class="chat-preview" hidden><img alt="Image ready to send"><button type="button" aria-label="Remove image" title="Remove image"></button></div>
      <textarea aria-label="Message" placeholder="Write a message or paste an image…" maxlength="8000" rows="2"></textarea>
      <div class="chat-actions"><button type="button" class="chat-attach" title="Attach image" aria-label="Attach image"></button><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose image" hidden><span>Enter to send · Shift+Enter for a new line</span><button type="submit" class="chat-send" title="Send message" aria-label="Send message"></button></div>
    </form><dialog class="chat-lightbox"><button type="button" aria-label="Close image" title="Close image"></button><img alt="Shared image"></dialog>`;
  const query = selector => root.querySelector(selector);
  const log = query('.chat-log'), form = query('form'), text = query('textarea'), status = query('.chat-status');
  const archive = query('select'), preview = query('.chat-preview'), fileInput = query('input[type=file]');
  const retry = query('.chat-retry'), newMessages = query('.chat-new'), lightbox = query('dialog');
  query('.chat-attach').replaceChildren(createToolIcon('image'));
  query('.chat-send').replaceChildren(createToolIcon('send'));
  preview.querySelector('button').replaceChildren(createToolIcon('close'));
  lightbox.querySelector('button').replaceChildren(createToolIcon('close'));
  let disposed = false, visible = false, busy = false, imageBusy = false, reading = false, dirty = false;
  let selected, snapshot, image, requestId, openedImageId, unread = 0, initialized = false, imageRevision = 0;
  const rows = new Map(), drafts = new Map(), days = new Map();
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const error = reason => { if (!disposed) { status.textContent = reason.message || String(reason); status.dataset.error = 'true'; retry.hidden = false; } };
  function controls() {
    const active = snapshot?.session && snapshot.session.id === snapshot.activeId;
    text.disabled = !active || busy; fileInput.disabled = query('.chat-attach').disabled = !active || busy || imageBusy;
    query('.chat-send').disabled = !active || busy || imageBusy || (!text.value.trim() && !image);
    preview.hidden = !image; if (image) preview.querySelector('img').src = image;
    preview.querySelector('button').disabled = busy;
  }
  function bottom() { log.scrollTop = log.scrollHeight; newMessages.hidden = true; unread = 0; adapter.unread?.(0); }
  function draft() { return { text: text.value, image, requestId }; }
  function restore(value = {}) { text.value = value.text || ''; image = value.image; requestId = value.requestId; imageRevision++; controls(); }
  function edited() { requestId = undefined; controls(); }
  function appendText(container, value) {
    const matcher = /https?:\/\/[^\s<>]+/g;
    let cursor = 0;
    for (const match of value.matchAll(matcher)) {
      container.append(document.createTextNode(value.slice(cursor, match.index)));
      const link = document.createElement('a'); link.textContent = match[0]; link.href = match[0]; link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (adapter.openLink) link.onclick = event => { event.preventDefault(); adapter.openLink(link.href); };
      container.append(link); cursor = match.index + match[0].length;
    }
    container.append(document.createTextNode(value.slice(cursor)));
  }
  function row(message, sessionId) {
    const node = document.createElement('article'); node.className = 'chat-message'; node.dataset.messageId = message.id;
    const header = document.createElement('header'), author = document.createElement('strong'), time = document.createElement('time');
    author.textContent = message.author; time.dateTime = message.createdAt;
    const date = new Date(message.createdAt); time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); time.title = date.toLocaleString();
    header.append(author, time);
    if (adapter.delete) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'chat-delete'; remove.title = 'Delete message'; remove.setAttribute('aria-label', `Delete message from ${message.author}`); remove.append(createToolIcon('trash'));
      remove.onclick = async () => { remove.disabled = true; try { await adapter.delete(sessionId, message.id); await refresh(); } catch (reason) { error(reason); } finally { remove.disabled = false; } };
      header.append(remove);
    }
    node.append(header);
    if (message.text) { const body = document.createElement('p'); appendText(body, message.text); node.append(body); }
    if (message.image) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'chat-image'; button.setAttribute('aria-label', 'Enlarge shared image');
      const img = document.createElement('img'); img.alt = `Image from ${message.author}`; img.loading = 'lazy'; button.append(img); node.append(button);
      Promise.resolve(adapter.image(sessionId, message.id)).then(url => { if (!disposed && rows.get(message.id) === node) img.src = url; }).catch(reason => { if (node.isConnected) { button.textContent = 'Image unavailable'; button.disabled = true; error(reason); } });
      button.onclick = () => { if (!img.src) return; openedImageId = message.id; lightbox.querySelector('img').src = img.src; lightbox.showModal(); };
      img.onload = () => { if (visible && newMessages.hidden) bottom(); };
    }
    return node;
  }
  function apply(value) {
    const previous = snapshot?.session?.id, next = value.session?.id;
    const changed = previous !== next;
    if (changed) {
      if (previous) drafts.set(previous, draft());
      snapshot = value; restore(drafts.get(next)); rows.clear(); days.clear(); log.replaceChildren(); initialized = false;
    } else snapshot = value;
    const atBottom = nearBottom(), oldScroll = log.scrollTop;
    const incoming = value.messages.filter(message => !rows.has(message.id)).length;
    const ids = new Set(value.messages.map(message => message.id));
    if (openedImageId && !ids.has(openedImageId)) lightbox.close();
    for (const [id, node] of rows) if (!ids.has(id)) { node.remove(); rows.delete(id); }
    const children = [], usedDays = new Set();
    let day;
    for (const message of value.messages) {
      const date = new Date(message.createdAt).toLocaleDateString();
      if (date !== day) {
        let separator = days.get(date);
        if (!separator) { separator = document.createElement('p'); separator.className = 'chat-day'; separator.textContent = date; days.set(date, separator); }
        children.push(separator); usedDays.add(date); day = date;
      }
      let node = rows.get(message.id);
      if (!node) { node = row(message, next); rows.set(message.id, node); }
      children.push(node);
    }
    for (const [date, node] of days) if (!usedDays.has(date)) { node.remove(); days.delete(date); }
    log.querySelector('.chat-empty')?.remove();
    if (!value.messages.length) { const empty = document.createElement('p'); empty.className = 'chat-empty'; empty.textContent = value.session ? 'No messages yet. Start the conversation.' : 'Chat will be available when sharing starts.'; children.push(empty); }
    // Keep existing message nodes in place, preserving focused links and images.
    let cursor = log.firstChild;
    for (const node of children) { if (node !== cursor) log.insertBefore(node, cursor); cursor = node.nextSibling; }
    if (initialized && incoming && (!visible || !atBottom)) { unread += incoming; adapter.unread?.(unread); newMessages.hidden = !visible; }
    if (!initialized || (visible && atBottom)) bottom(); else log.scrollTop = oldScroll;
    // A hidden initial snapshot is history, not unread traffic.
    initialized = true;
    if (value.sessions) {
      query('.chat-archive').hidden = false;
      const options = [new Option(value.activeId ? 'Current session' : 'Most recent session', '')];
      for (const session of value.sessions) options.push(new Option(`${new Date(session.startedAt).toLocaleString()} · ${session.count} messages${session.endedAt ? '' : ' · Live'}`, session.id));
      archive.replaceChildren(...options); archive.value = selected || '';
    }
    status.textContent = value.session?.endedAt ? 'Archived conversation' : value.session ? 'Everyone in this session can see these messages.' : 'No sharing session.';
    status.dataset.error = ''; retry.hidden = true; controls();
  }
  async function refresh() {
    if (disposed) return;
    dirty = true;
    if (reading) return;
    reading = true;
    try {
      while (dirty && !disposed) {
        dirty = false; const scope = selected;
        const value = await adapter.read(scope);
        if (!disposed && scope === selected && !dirty) apply(value);
      }
    } catch (reason) { error(reason); }
    finally { reading = false; }
  }
  archive.onchange = () => { selected = archive.value || undefined; void refresh(); };
  retry.onclick = () => { void refresh(); };
  newMessages.onclick = bottom;
  log.onscroll = () => { if (visible && nearBottom()) bottom(); };
  text.oninput = edited;
  text.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!query('.chat-send').disabled) form.requestSubmit(); } };
  async function attach(file) {
    if (busy || text.disabled || imageBusy || !file) return;
    const scope = snapshot?.session?.id, revision = ++imageRevision;
    imageBusy = true; controls();
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use a PNG, JPEG or WebP image.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Images must be at most 5 MB.');
      const bitmap = await createImageBitmap(file);
      const tooLarge = bitmap.width * bitmap.height > 64000000 || bitmap.width > 16384 || bitmap.height > 16384; bitmap.close();
      if (tooLarge) throw new Error('Image dimensions are too large.');
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(file); });
      if (!disposed && scope === snapshot?.session?.id && revision === imageRevision) { image = data; requestId = undefined; status.textContent = 'Image ready to send.'; status.dataset.error = ''; }
    } catch (reason) { error(reason); }
    finally { imageBusy = false; if (!disposed) controls(); }
  }
  text.onpaste = event => {
    const item = [...(event.clipboardData?.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (item) { event.preventDefault(); void attach(item.getAsFile()); }
  };
  query('.chat-attach').onclick = () => fileInput.click();
  fileInput.onchange = () => { void attach(fileInput.files[0]); fileInput.value = ''; };
  preview.querySelector('button').onclick = () => { image = undefined; edited(); };
  form.onsubmit = async event => {
    event.preventDefault(); if (query('.chat-send').disabled || !snapshot?.session) return;
    const sessionId = snapshot.session.id;
    requestId ||= globalThis.crypto?.randomUUID?.() || `message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const input = { text: text.value, ...(image ? { image } : {}), requestId };
    busy = true; controls(); status.textContent = 'Sending…'; retry.hidden = true;
    try {
      await adapter.send(sessionId, input);
      drafts.delete(sessionId);
      if (!disposed && snapshot?.session?.id === sessionId) { restore(); await refresh(); bottom(); text.focus(); }
    } catch (reason) { error(reason); }
    finally { busy = false; if (!disposed) { controls(); if (snapshot?.session?.id === sessionId && !text.disabled) text.focus(); } }
  };
  lightbox.onclose = () => { openedImageId = undefined; lightbox.querySelector('img').removeAttribute('src'); };
  lightbox.querySelector('button').onclick = () => lightbox.close();
  lightbox.onclick = event => { if (event.target === lightbox) lightbox.close(); };
  const unsubscribe = adapter.subscribe(() => { void refresh(); });
  controls(); void refresh();
  return {
    refresh,
    setVisible(value) { visible = value; if (visible) bottom(); },
    dispose() { disposed = true; imageRevision++; unsubscribe?.(); lightbox.close(); }
  };
}
