const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const previewPane = document.getElementById('preview-pane');
const previewFrame = document.getElementById('preview-frame');
const fileInput = document.getElementById('file-input');
const fileChip = document.getElementById('file-chip');
const fileChipName = document.getElementById('file-chip-name');

let history = [];
let sessions = [];
let currentTitle = null;
let lastPreviewCode = '';
let pendingFile = null;

const ALLOWED = ['png','jpg','jpeg','rar','zip','js','ts','py','html','css','txt','md','json','log'];

try { sessions = JSON.parse(localStorage.getItem('sgpt_sessions') || '[]'); } catch(e) {}

marked.setOptions({ breaks: true });

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 130) + 'px';
});
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});

const isMobile = () => 'ontouchstart' in window || window.innerWidth <= 768;

// ── HELPER: always get fresh reference ──
function getChatInner() {
  return document.getElementById('chat-inner');
}

// ── FILE UPLOAD ──
function openFilePicker() { fileInput.click(); }

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!ALLOWED.includes(ext)) {
    alert('File type not allowed: .' + ext);
    fileInput.value = '';
    return;
  }
  pendingFile = file;
  fileChipName.textContent = file.name;
  fileChip.style.display = 'flex';
  fileInput.value = '';
});

function removeFile() {
  pendingFile = null;
  fileChip.style.display = 'none';
  fileChipName.textContent = '';
}

// ── SUGGEST ──
function suggest(btn) {
  const b = btn.querySelector('b');
  inputEl.value = btn.textContent.replace(b ? b.textContent : '', '').trim();
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 130) + 'px';
  if (!isMobile()) inputEl.focus();
}

// ── SIDEBAR ──
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

function emptyHTML() {
  return '<div id="empty">' +
    '<div class="empty-icon">🐍</div>' +
    '<div class="empty-title">Snake<em>GPT</em> AI</div>' +
    '<div class="empty-sub">Professional coding assistant and OSINT intelligence center. Write, debug, explain — and preview HTML/CSS/JS live.</div>' +
    '<div class="sugs">' +
    '<button class="sug" onclick="suggest(this)"><b>Generate</b>Write a Python web scraper</button>' +
    '<button class="sug" onclick="suggest(this)"><b>Analyze</b>Network reconnaissance</button>' +
    '<button class="sug" onclick="suggest(this)"><b>Explain</b>How does async/await work?</button>' +
    '<button class="sug" onclick="suggest(this)"><b>Intelligence</b>Gather OSINT data</button>' +
    '<button class="sug" onclick="suggest(this)"><b>Preview</b>Make a cool CSS animation</button>' +
    '<button class="sug" onclick="suggest(this)"><b>Debug</b>Fix the errors in my code</button>' +
    '</div></div>';
}

// ── NEW CHAT ──
function newChat() {
  history = [];
  currentTitle = null;
  // Always get a fresh DOM reference instead of using stale variable
  const container = document.getElementById('chat-inner');
  container.innerHTML = emptyHTML();
  removeFile();
  closePreview();
  closeSidebar();
  renderHistory();
}

function removeEmpty() {
  // Always query fresh — avoids stale reference bug
  const e = document.getElementById('empty');
  if (e) e.remove();
}

// ── LANG / PREVIEW ──
function getLang(block) {
  const cls = [...block.classList].find(c => c.startsWith('language-'));
  return cls ? cls.replace('language-', '') : '';
}

function isPreviewable(lang) {
  return ['html', 'htm'].includes(lang.toLowerCase());
}

function buildFullPreview(htmlCode, bubble) {
  const cssBlocks = [];
  const jsBlocks = [];
  bubble.querySelectorAll('pre code').forEach(block => {
    const lang = getLang(block).toLowerCase();
    const src = block.textContent;
    if (lang === 'css') cssBlocks.push(src);
    if (lang === 'js' || lang === 'javascript') jsBlocks.push(src);
  });
  let base = htmlCode;
  if (cssBlocks.length) {
    const styleTag = '<style>\n' + cssBlocks.join('\n') + '\n</style>';
    base = base.includes('</head>') ? base.replace('</head>', styleTag + '\n</head>') : styleTag + '\n' + base;
  }
  if (jsBlocks.length) {
    const scriptTag = '<script>\n' + jsBlocks.join('\n') + '\n<\/script>';
    base = base.includes('</body>') ? base.replace('</body>', scriptTag + '\n</body>') : base + '\n' + scriptTag;
  }
  return base;
}

function openPreview(htmlCode, bubble) {
  lastPreviewCode = buildFullPreview(htmlCode, bubble);
  previewPane.classList.add('open');
  previewFrame.srcdoc = lastPreviewCode;
}

function refreshPreview() {
  const tmp = lastPreviewCode;
  previewFrame.srcdoc = '';
  setTimeout(() => { previewFrame.srcdoc = tmp; }, 50);
}

function closePreview() {
  previewPane.classList.remove('open');
  previewFrame.srcdoc = '';
  lastPreviewCode = '';
}

// ── DOWNLOAD DETECTION ──
function parseDownloads(text) {
  const regex = /DOWNLOAD_FILE\[([^\]]+)\]\n([\s\S]*?)END_DOWNLOAD_FILE/g;
  const downloads = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    downloads.push({ filename: match[1], content: match[2] });
  }
  const clean = text.replace(/DOWNLOAD_FILE\[[^\]]+\]\n[\s\S]*?END_DOWNLOAD_FILE/g, '').trim();
  return { clean, downloads };
}

async function triggerDownload(filename, content) {
  try {
    const res = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content })
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) {
    console.error('Download failed:', e);
  }
}

function makeDownloadBtn(filename, content) {
  const btn = document.createElement('button');
  btn.className = 'download-btn';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' + filename;
  btn.onclick = () => triggerDownload(filename, content);
  return btn;
}

// ── ADD MESSAGE ──
function addMsg(role, rawContent) {
  removeEmpty();
  // Always use fresh DOM reference
  const chatInner = getChatInner();

  const msg = document.createElement('div');
  msg.className = 'msg ' + role;

  const av = document.createElement('div');
  av.className = 'av';
  av.textContent = role === 'user' ? 'U' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'ai') {
    const { clean, downloads } = parseDownloads(rawContent);
    bubble.innerHTML = marked.parse(clean);

    bubble.querySelectorAll('pre code').forEach(block => {
      hljs.highlightElement(block);
      const lang = getLang(block);
      const code = block.textContent;
      const pre = block.parentElement;

      const toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';

      const langLabel = document.createElement('span');
      langLabel.className = 'code-lang';
      langLabel.textContent = lang || 'code';

      const actions = document.createElement('div');
      actions.className = 'code-actions';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(code);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy', 1500);
      };
      actions.appendChild(copyBtn);

      const dlBtn = document.createElement('button');
      dlBtn.className = 'code-btn';
      dlBtn.textContent = '↓ Save';
      const ext = lang || 'txt';
      dlBtn.onclick = () => triggerDownload('snakegpt_code.' + ext, code);
      actions.appendChild(dlBtn);

      if (isPreviewable(lang)) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'code-btn preview-trigger';
        prevBtn.textContent = '▶ Preview';
        prevBtn.onclick = () => openPreview(code, bubble);
        actions.appendChild(prevBtn);
      }

      toolbar.appendChild(langLabel);
      toolbar.appendChild(actions);
      pre.insertBefore(toolbar, pre.firstChild);
    });

    if (downloads.length) {
      const dlWrap = document.createElement('div');
      dlWrap.className = 'dl-wrap';
      downloads.forEach(d => dlWrap.appendChild(makeDownloadBtn(d.filename, d.content)));
      bubble.appendChild(dlWrap);
    }

  } else {
    bubble.textContent = rawContent;
  }

  msg.appendChild(av);
  msg.appendChild(bubble);
  chatInner.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addThinking() {
  removeEmpty();
  const chatInner = getChatInner();

  const msg = document.createElement('div');
  msg.className = 'msg ai'; msg.id = 'thinking';
  const av = document.createElement('div'); av.className = 'av'; av.textContent = 'AI';
  const b = document.createElement('div'); b.className = 'bubble';
  b.innerHTML = '<div class="thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  msg.appendChild(av); msg.appendChild(b);
  chatInner.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
}

// ── HISTORY ──
function saveSession(title) {
  try {
    const idx = sessions.findIndex(s => s.title === title);
    const s = { title, history, time: Date.now() };
    if (idx >= 0) sessions[idx] = s; else sessions.unshift(s);
    if (sessions.length > 30) sessions = sessions.slice(0, 30);
    localStorage.setItem('sgpt_sessions', JSON.stringify(sessions));
    renderHistory();
  } catch(e) {}
}

function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  sessions.forEach((s, idx) => {
    const item = document.createElement('div');
    item.className = 'h-item' + (s.title === currentTitle ? ' active' : '');
    item.innerHTML =
      '<svg class="h-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      '<div class="h-item-label"><span class="h-title">' + s.title + '</span></div>' +
      '<div class="h-item-actions">' +
        '<button class="h-act ren" title="Rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
        '<button class="h-act del" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>' +
      '</div>';

    item.addEventListener('click', (e) => {
      if (e.target.closest('.h-act')) return;
      history = s.history;
      currentTitle = s.title;
      const container = document.getElementById('chat-inner');
      container.innerHTML = '';
      history.forEach(m => addMsg(m.role === 'assistant' ? 'ai' : 'user', m.content));
      renderHistory();
      closeSidebar();
    });

    item.querySelector('.ren').addEventListener('click', (e) => {
      e.stopPropagation();
      const labelEl = item.querySelector('.h-title');
      const oldTitle = s.title;
      const input = document.createElement('input');
      input.value = oldTitle;
      input.onclick = e2 => e2.stopPropagation();
      input.onblur = input.onkeydown = (ev) => {
        if (ev.type === 'keydown' && ev.key !== 'Enter') return;
        const newTitle = input.value.trim() || oldTitle;
        sessions[idx].title = newTitle;
        if (currentTitle === oldTitle) currentTitle = newTitle;
        try { localStorage.setItem('sgpt_sessions', JSON.stringify(sessions)); } catch(_) {}
        renderHistory();
      };
      labelEl.replaceWith(input);
      input.focus(); input.select();
    });

    item.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      item.classList.add('deleting');
      setTimeout(() => {
        if (currentTitle === s.title) {
          currentTitle = null;
          history = [];
          const container = document.getElementById('chat-inner');
          container.innerHTML = emptyHTML();
          closePreview();
        }
        sessions.splice(idx, 1);
        try { localStorage.setItem('sgpt_sessions', JSON.stringify(sessions)); } catch(_) {}
        renderHistory();
      }, 200);
    });

    list.appendChild(item);
  });
}

// ── SEND ──
async function sendMsg() {
  const text = inputEl.value.trim();
  if (!text && !pendingFile) return;
  if (sendBtn.disabled) return;

  inputEl.value = ''; inputEl.style.height = 'auto';
  sendBtn.disabled = true;

  const displayText = text || ('Uploaded: ' + (pendingFile ? pendingFile.name : ''));
  addMsg('user', displayText);
  if (!currentTitle) currentTitle = displayText.slice(0, 42) + (displayText.length > 42 ? '…' : '');

  if (text) history.push({ role: 'user', content: text });

  addThinking();

  try {
    let res;
    if (pendingFile) {
      const fd = new FormData();
      fd.append('file', pendingFile);
      fd.append('messages', JSON.stringify(text ? [...history.slice(0, -1)] : history));
      if (text) fd.append('userText', text);
      res = await fetch('/chat', { method: 'POST', body: fd });
    } else {
      res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });
    }

    const data = await res.json();
    document.getElementById('thinking')?.remove();

    if (data.error) {
      addMsg('ai', '**Error:** ' + data.error);
    } else {
      addMsg('ai', data.reply);
      history.push({ role: 'assistant', content: data.reply });
      saveSession(currentTitle);
    }
  } catch(e) {
    document.getElementById('thinking')?.remove();
    addMsg('ai', '**Connection error.** Please try again.');
  }

  removeFile();
  sendBtn.disabled = false;
  if (!isMobile()) inputEl.focus();
}

renderHistory();
