import { createShareChat } from '../shareChat.js';

/** Owns the single chat subscription for this authenticated browser. */
export function startShareChatClient({ api, root, button, workspace }) {
  let open = false, events, disposed = false;
  const badge = document.createElement('span'); badge.className = 'chat-unread'; badge.hidden = true; button.append(badge);
  root.innerHTML = '<header class="client-chat-heading"><strong>Session chat</strong><button type="button" aria-label="Close chat">×</button></header><div class="client-chat-body"></div>';
  const view = createShareChat(root.querySelector('.client-chat-body'), {
    read: () => api('/api/chat'),
    send: (sessionId, input) => api('/api/chat/send', { sessionId, ...input }),
    image: (_sessionId, messageId) => `/api/chat/image/${encodeURIComponent(messageId)}`,
    subscribe: callback => {
      events = new EventSource('/api/chat/events');
      events.onmessage = events.onopen = () => callback();
      // Refetch checks authorization as well as reporting lost connectivity.
      events.onerror = () => { if (!disposed) callback(); };
      return () => events.close();
    },
    unread: count => { badge.hidden = !count; badge.textContent = count > 99 ? '99+' : String(count); button.title = count ? `Chat · ${count} unread messages` : 'Chat'; button.setAttribute('aria-label', button.title); }
  });
  function toggle(value) {
    open = value; root.hidden = !open; workspace.classList.toggle('chat-open', open);
    button.setAttribute('aria-pressed', String(open)); view.setVisible(open);
    if (open) root.querySelector('textarea').focus();
  }
  button.hidden = false; button.onclick = () => toggle(!open);
  root.querySelector('.client-chat-heading button').onclick = () => { toggle(false); button.focus(); };
  return () => {
    disposed = true; view.dispose(); toggle(false); badge.remove(); root.replaceChildren(); button.hidden = true; button.onclick = null;
  };
}
