// TradeShield AI 悬浮助手 — 原生 JS 实现
// 1) 右侧悬浮图标（可拖拽、hover 展开、点击打开弹窗）
// 2) AI 对话弹窗（Coze 流式 API）
//
// 基于 paymind 的 floating-button.tsx + popup-assistant.tsx 转换，
// 适配 TradeShield-AI 原生 JS 架构与暗色主题。

import { $, el, clear } from './dom.js';

// ===========================================================================
// Coze API 配置 & 流式客户端（内联，零外部依赖）
// ===========================================================================
const COZE_CONFIG = {
  API_TOKEN: 'pat_XUph8jnpqmx82WegBQAhfEHqT9yll9YmE2XjCltmXiCYLKVju3QP7RaQ6kc6B6wH',
  BOT_ID: '7578017691110621230',
  API_URL: 'https://api.coze.cn/v3/chat',
  CREATE_CONVERSATION_URL: 'https://api.coze.cn/v1/conversation/create',
};

class CozeClient {
  constructor() {
    if (CozeClient._inst) return CozeClient._inst;
    this._conv = {}; CozeClient._inst = this;
  }
  async _createConversation(uid) {
    if (this._conv[uid]) return this._conv[uid];
    const res = await fetch(COZE_CONFIG.CREATE_CONVERSATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${COZE_CONFIG.API_TOKEN}` },
      body: JSON.stringify({ bot_id: COZE_CONFIG.BOT_ID, user_id: uid, stream: false, auto_save_history: true, additional_messages: [] })
    });
    const d = await res.json();
    if (d.code !== 0) throw new Error(d.msg || '创建会话失败');
    this._conv[uid] = d.data.id;
    return d.data.id;
  }
  async streamChat(uid, query, onChunk) {
    const cid = await this._createConversation(uid);
    const url = `${COZE_CONFIG.API_URL}?conversation_id=${cid}`;
    const msgs = [{ role: 'user', content: query, content_type: 'text' }];
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${COZE_CONFIG.API_TOKEN}` },
      body: JSON.stringify({ bot_id: COZE_CONFIG.BOT_ID, user_id: uid, query, additional_messages: msgs, stream: true, auto_save_history: true })
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let result = '', buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.includes('[DONE]')) continue;
        if (line.startsWith('event:conversation.message.delta')) {
          const di = lines.slice(i + 1).findIndex(l => l.startsWith('data:'));
          if (di !== -1) {
            try {
              const j = JSON.parse(lines[i + 1 + di].replace('data:', '').trim());
              const role = j.data?.role || j.role, content = j.data?.content || j.content || '';
              if (role === 'assistant' && content && typeof content === 'string') { result += content; onChunk?.(content); }
            } catch (_) {}
            i += di;
          }
        } else if (line.startsWith('data:')) {
          try {
            const j = JSON.parse(line.replace('data:', '').trim());
            if (j.role === 'assistant' && j.type === 'answer' && j.content) {
              const c = String(j.content);
              if (c.length > result.length) { const inc = c.slice(result.length); result = c; onChunk?.(inc); }
              else if (!result && c) { result = c; onChunk?.(c); }
            }
          } catch (_) {}
        }
      }
    }
    return result;
  }
}
const coze = new CozeClient();

// ===========================================================================
// 样式注入（自包含）
// ===========================================================================
const STYLES = /* css */`
/* ---- 悬浮按钮 ---- */
.pa-float {
  position: fixed; z-index: 9999; touch-action: none; user-select: none;
  transition: transform 0.22s ease;
  cursor: grab;
}
.pa-float:active { cursor: grabbing; }
.pa-float-icon {
  width: 100%; height: 100%; border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #5b9cff 0%, #1a4fc0 100%);
  box-shadow: 0 6px 24px rgba(79,140,255,0.40), 0 0 0 3px rgba(79,140,255,0.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 40px; color: #fff;
  transition: box-shadow 0.22s, transform 0.22s;
}
.pa-float:hover .pa-float-icon,
.pa-float.dragging .pa-float-icon {
  box-shadow: 0 8px 32px rgba(79,140,255,0.55), 0 0 0 5px rgba(79,140,255,0.25);
  transform: scale(1.06);
}
.pa-float-badge {
  position: absolute; top: -2px; right: -2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--ok, #34d399); border: 2px solid var(--bg, #070b16);
  animation: paPulse 1.8s infinite;
}
@keyframes paPulse {
  0%,100% { box-shadow: 0 0 0 0 #34d39988; }
  50% { box-shadow: 0 0 0 8px transparent; }
}

/* ---- 弹窗 ---- */
.pa-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
}
.pa-dialog {
  width: 520px; max-width: 95vw; height: 620px; max-height: 85vh;
  display: flex; flex-direction: column;
  background: var(--panel, #0e1424);
  border: 1px solid var(--line, #1f2942);
  border-radius: 18px; box-shadow: 0 32px 80px rgba(0,0,0,0.55);
  overflow: hidden; animation: paPopIn 0.22s ease;
}
@keyframes paPopIn { from { opacity:0; transform:scale(0.94) translateY(10px); } to { opacity:1; transform:none; } }
.pa-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--line, #1f2942);
}
.pa-title { font-size: 16px; font-weight: 700; color: var(--accent, #4f8cff); margin: 0; }
.pa-close { background:none; border:none; color:var(--text-2); font-size:18px; cursor:pointer; padding:4px 8px; border-radius:6px; }
.pa-close:hover { color:var(--text); }
.pa-info {
  padding: 10px 18px; border-bottom: 1px solid var(--line, #1f2942);
  background: var(--bg-2, #0a0f1f);
}
.pa-info-row { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
.pa-dot { width:10px; height:10px; background:var(--accent); border-radius:50%; }
.pa-info-text { font-size:12px; font-weight:600; color:var(--text-2); letter-spacing:0.04em; }
.pa-info-sub { display:flex; align-items:center; justify-content:space-between; }
.pa-version { font-size:11px; color:var(--text-3); }
.pa-status-dot { width:7px; height:7px; background:var(--ok); border-radius:50%; }
.pa-msgs { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }
.pa-msg-row { display:flex; }
.pa-msg-user { justify-content:flex-end; }
.pa-msg-assistant { justify-content:flex-start; }
.pa-bubble { max-width:80%; padding:10px 14px; border-radius:12px; font-size:14px; line-height:1.55; word-break:break-word; white-space:pre-wrap; }
.pa-bubble-user { background:var(--accent); color:#fff; border-bottom-right-radius:4px; }
.pa-bubble-assistant { background:var(--card); color:var(--text); border:1px solid var(--line); border-bottom-left-radius:4px; }
.pa-loading { display:flex; align-items:center; gap:5px; padding:14px 18px; }
.pa-dot-bounce { width:7px; height:7px; background:var(--text-3); border-radius:50%; animation:paB 0.8s infinite ease-in-out; }
.pa-dot-bounce:nth-child(2) { animation-delay:0.2s; }
.pa-dot-bounce:nth-child(3) { animation-delay:0.4s; }
@keyframes paB { 0%,100%{transform:translateY(0);opacity:0.35} 50%{transform:translateY(-6px);opacity:1} }
.pa-quick-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:4px; }
.pa-quick-btn {
  padding:10px 14px; font-size:13px; line-height:1.45;
  background:var(--card); color:var(--text);
  border:1px solid var(--line); border-radius:10px;
  cursor:pointer; text-align:left; transition:background 0.15s,border-color 0.15s;
}
.pa-quick-btn:hover { background:var(--panel-2); border-color:var(--accent); }
.pa-input-row { display:flex; align-items:center; gap:8px; padding:14px 18px; border-top:1px solid var(--line); }
.pa-input {
  flex:1; padding:10px 14px;
  background:var(--bg-2); color:var(--text);
  border:1px solid var(--line); border-radius:10px;
  font-size:14px; outline:none; transition:border-color 0.15s;
}
.pa-input:focus { border-color:var(--accent); }
.pa-input::placeholder { color:var(--text-3); }
.pa-send {
  width:40px; height:40px; display:flex; align-items:center; justify-content:center;
  background:var(--accent); color:#fff; border:none; border-radius:10px; font-size:16px;
  cursor:pointer; transition:opacity 0.15s;
}
.pa-send:hover:not(:disabled) { opacity:0.85; }
.pa-send:disabled { opacity:0.35; cursor:not-allowed; }
`;

// ===========================================================================
// FloatingButton —— 可拖拽悬浮图标
// ===========================================================================
class FloatingButton {
  constructor({ size = 72, onClick } = {}) {
    this.size = size;
    this.onClick = onClick;
    this.left = 0; this.top = 0;
    this.dragging = false; this.moved = false; this.hovering = false;
    this._ptrId = null;
    this._startX = 0; this._startY = 0;
    this._offX = 0; this._offY = 0;
    this._el = null;
    this._create();
  }

  _clamp(v, mn, mx) { return Math.min(Math.max(v, mn), mx); }

  _create() {
    const self = this;
    const gap = 20;
    const peek = 16; // 收起时露出的像素

    this._el = el('div', { class: 'pa-float' });
    this._el.style.width = this._el.style.height = `${this.size}px`;

    const icon = el('div', { class: 'pa-float-icon', html: '🤖' });
    const badge = el('div', { class: 'pa-float-badge' });
    this._el.append(icon, badge);

    // 初始位置：右下
    const place = () => {
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      this.left = w - this.size - gap;
      this.top = Math.round(h * 0.62);
      this._applyPos();
    };

    const updateTransform = () => {
      if (this.dragging || this.hovering) {
        this._el.style.transform = 'translateX(0)';
      } else {
        this._el.style.transform = `translateX(calc(${this.size}px - ${peek}px))`;
      }
    };

    // Pointer events
    this._el.addEventListener('pointerdown', (e) => {
      if (self.dragging) return;
      self._ptrId = e.pointerId; self._el.setPointerCapture(e.pointerId);
      self.dragging = true; self.moved = false; self.hovering = true;
      self._el.style.transition = 'none';
      self._startX = e.clientX; self._startY = e.clientY;
      self._offX = e.clientX - self.left; self._offY = e.clientY - self.top;
      updateTransform();
    });
    this._el.addEventListener('pointermove', (e) => {
      if (!self.dragging || e.pointerId !== self._ptrId) return;
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      self.left = self._clamp(e.clientX - self._offX, 10, w - self.size - 10);
      self.top = self._clamp(e.clientY - self._offY, 10, h - self.size - 10);
      self._applyPos();
      if (!self.moved && Math.hypot(e.clientX - self._startX, e.clientY - self._startY) > 4) self.moved = true;
    });
    const up = (e) => {
      if (!self.dragging) return;
      if (self._ptrId !== null) { try { self._el.releasePointerCapture(self._ptrId); } catch(_){} }
      self._ptrId = null; self.dragging = false;
      self._el.style.transition = 'transform 0.22s ease, left 0.2s ease, top 0.2s ease';
      // 吸附右边
      const w = document.documentElement.clientWidth;
      self.left = w - self.size - 20;
      self._applyPos();
      if (!self.moved) self.onClick?.();
      self.moved = false;
      updateTransform();
    };
    this._el.addEventListener('pointerup', up);
    this._el.addEventListener('pointercancel', up);
    this._el.addEventListener('pointerleave', up);

    // Hover
    this._el.addEventListener('mouseenter', () => { self.hovering = true; updateTransform(); });
    this._el.addEventListener('mouseleave', () => { self.hovering = false; updateTransform(); });

    // Resize
    const onResize = () => {
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      self.left = self._clamp(self.left, 10, w - self.size - 10);
      self.top = self._clamp(self.top, 10, h - self.size - 10);
      self._applyPos();
    };
    window.addEventListener('resize', onResize, { passive: true });

    // 初始定位
    setTimeout(place, 10);
    setTimeout(updateTransform, 50);

    document.body.appendChild(this._el);
  }

  _applyPos() {
    if (!this._el) return;
    this._el.style.left = `${this.left}px`;
    this._el.style.top = `${this.top}px`;
  }

  destroy() {
    if (this._el) { this._el.remove(); this._el = null; }
  }
}

// ===========================================================================
// PopupAssistant —— AI 对话弹窗
// ===========================================================================
class PopupAssistant {
  constructor() {
    this.isOpen = false;
    this.messages = [{ id: 1, text: '你好！我是 TradeShield AI 助手，可以解答关于 RWA 动态定价、风险管理、提单上链等问题。需要什么帮助？', sender: 'assistant' }];
    this.isLoading = false;
    this.userId = `ts_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this._asstId = null;
    this._overlay = null;
  }

  get quickActions() {
    return [
      'TradeShield 如何为 RWA 动态定价？',
      'AI 风险评分包含哪些维度？',
      'RWA 铸造上链的完整流程是怎样的？',
      '什么是定价瀑布（waterfall）？'
    ];
  }

  open() { if (!this.isOpen) { this.isOpen = true; this._render(); } }
  close() {
    this.isOpen = false;
    if (this._overlay) { this._overlay.remove(); this._overlay = null; }
  }
  toggle() { this.isOpen ? this.close() : this.open(); }

  _render() {
    const self = this;
    this._overlay = el('div', { class: 'pa-overlay', onclick: (e) => { if (e.target === self._overlay) self.close(); } });

    const dlg = el('div', { class: 'pa-dialog' });

    // Header
    dlg.append(el('div', { class: 'pa-header' },
      el('h2', { class: 'pa-title', text: '◈ TradeShield AI 助手' }),
      el('button', { class: 'pa-close', text: '✕', onclick: () => self.close() })
    ));

    // Info bar
    dlg.append(el('div', { class: 'pa-info' },
      el('div', { class: 'pa-info-row' },
        el('span', { class: 'pa-dot' }),
        el('span', { class: 'pa-info-text', text: 'TRADESHIELD AI · COPILOT' })
      ),
      el('div', { class: 'pa-info-sub' },
        el('span', { class: 'pa-version', text: 'Powered by Coze · Streaming' }),
        el('span', { class: 'pa-status-dot' })
      )
    ));

    // Messages
    const msgList = el('div', { class: 'pa-msgs' });
    dlg.append(msgList);

    // Input
    const input = el('input', {
      class: 'pa-input', type: 'text', placeholder: '输入消息…',
      onkeydown: (e) => { if (e.key === 'Enter' && !self.isLoading) self._send(input.value); }
    });
    const sendBtn = el('button', {
      class: 'pa-send', disabled: true, html: '➤',
      onclick: () => self._send(input.value)
    });
    input.addEventListener('input', () => { sendBtn.disabled = self.isLoading || !input.value.trim(); });
    dlg.append(el('div', { class: 'pa-input-row' }, input, sendBtn));

    this._overlay.appendChild(dlg);
    document.body.appendChild(this._overlay);

    // Escape
    const esc = (e) => { if (e.key === 'Escape') { self.close(); document.removeEventListener('keydown', esc); } };
    document.addEventListener('keydown', esc);

    // 渲染消息
    const renderMsgs = () => {
      clear(msgList);
      for (const m of self.messages) {
        msgList.append(el('div', { class: `pa-msg-row pa-msg-${m.sender}` },
          el('div', { class: `pa-bubble pa-bubble-${m.sender}` }, m.text)
        ));
      }
      // Loading
      if (self.isLoading && self.messages[self.messages.length - 1]?.sender === 'assistant' && !self.messages[self.messages.length - 1]?.text) {
        msgList.append(el('div', { class: 'pa-msg-row pa-msg-assistant' },
          el('div', { class: 'pa-bubble pa-bubble-assistant pa-loading' },
            el('span', { class: 'pa-dot-bounce' }),
            el('span', { class: 'pa-dot-bounce' }),
            el('span', { class: 'pa-dot-bounce' })
          )
        ));
      }
      // Quick actions
      if (!self.isLoading) {
        const grid = el('div', { class: 'pa-quick-grid' });
        for (const a of self.quickActions) {
          grid.append(el('button', { class: 'pa-quick-btn', text: a, onclick: () => self._send(a) }));
        }
        msgList.append(grid);
      }
      msgList.scrollTop = msgList.scrollHeight;
    };
    this._renderMsgs = renderMsgs;
    renderMsgs();
    setTimeout(() => input.focus(), 150);
  }

  async _send(text) {
    const txt = (text || '').trim();
    if (!txt || this.isLoading) return;
    this.messages.push({ id: Date.now(), text: txt, sender: 'user' });
    this.isLoading = true;
    const asstId = Date.now() + 1; this._asstId = asstId;
    this.messages.push({ id: asstId, text: '', sender: 'assistant' });
    this._renderMsgs?.();

    try {
      await coze.streamChat(this.userId, txt, (chunk) => {
        const m = this.messages.find(x => x.id === this._asstId && x.sender === 'assistant');
        if (m) m.text += chunk;
        this._updateBubble();
      });
    } catch (e) {
      const m = this.messages.find(x => x.id === this._asstId);
      if (m) m.text = e instanceof Error ? e.message : '发送失败，请重试。';
    } finally {
      this.isLoading = false; this._asstId = null;
      this._renderMsgs?.();
      // refocus input
      const inp = this._overlay?.querySelector('.pa-input');
      if (inp) setTimeout(() => inp.focus(), 50);
    }
  }

  _updateBubble() {
    const bubbles = this._overlay?.querySelectorAll('.pa-bubble-assistant:not(.pa-loading)');
    if (!bubbles?.length) return;
    const last = bubbles[bubbles.length - 1];
    const m = this.messages.find(x => x.id === this._asstId && x.sender === 'assistant');
    if (m && last) last.textContent = m.text;
    const msgs = this._overlay?.querySelector('.pa-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }
}

// ===========================================================================
// 初始化入口
// ===========================================================================
let _inst = null;

export function initPopupAssistant() {
  if (_inst) return _inst;

  // 注入样式
  if (!document.getElementById('pa-styles')) {
    const s = document.createElement('style'); s.id = 'pa-styles'; s.textContent = STYLES;
    document.head.appendChild(s);
  }

  const popup = new PopupAssistant();

  // 创建悬浮按钮
  new FloatingButton({
    size: 72,
    onClick: () => popup.open()
  });

  _inst = popup;
  return _inst;
}

export function getPopupAssistant() {
  return _inst;
}
