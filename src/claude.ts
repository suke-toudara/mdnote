import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { diffLines } from 'diff';
import { isTauri } from './platform';

type DocumentSnapshot = { id: number; name: string; markdown: string };
type WorkspaceStatus = { folder: string | null; dirtyPaths: string[] };
type KeyStatus = { source: 'keychain' | 'session' | 'environment' | 'none'; keychainError: boolean };
export type AgentProposal = { path: string; original: string | null; content: string };
type AgentRun = { id: number; message: string; steps: string[]; proposals: AgentProposal[] };

export function setupClaude(
  getDocument: () => DocumentSnapshot,
  applyDocument: (markdown: string) => void,
  getWorkspace: () => WorkspaceStatus,
  onAgentApplied: (folder: string, proposals: AgentProposal[]) => void,
) {
  const panel = document.getElementById('claude-panel')!;
  const toggle = document.getElementById('btn-claude') as HTMLButtonElement;
  const keyInput = document.getElementById('claude-key') as HTMLInputElement;
  const keyStatus = document.getElementById('claude-key-status')!;
  const chatKeyState = document.getElementById('chat-key-state')!;
  const model = document.getElementById('claude-model') as HTMLSelectElement;
  const question = document.getElementById('claude-question') as HTMLTextAreaElement;
  const send = document.getElementById('claude-send') as HTMLButtonElement;
  const edit = document.getElementById('claude-edit') as HTMLButtonElement;
  const agentButton = document.getElementById('agent-run') as HTMLButtonElement;
  const progress = document.getElementById('agent-progress')!;
  const messages = document.getElementById('claude-messages')!;
  const proposal = document.getElementById('claude-proposal')!;
  const proposalText = document.getElementById('claude-proposal-text') as HTMLTextAreaElement;
  const agentReview = document.getElementById('agent-review')!;
  const agentFiles = document.getElementById('agent-files')!;
  let proposalSource: DocumentSnapshot | null = null;
  let agentResult: AgentRun | null = null;
  let agentFolder: string | null = null;
  let conversation: Array<{ content: string }> = [];
  let conversationTab: number | null = null;
  let busy = false;
  let agentBusy = false;

  function show(open: boolean) {
    panel.hidden = !open;
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) question.focus();
  }

  function addMessage(role: 'user' | 'assistant' | 'error', text: string) {
    const item = document.createElement('div');
    item.className = `claude-message claude-${role}`;
    item.textContent = text;
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function setBusy(value: boolean) {
    busy = value;
    send.disabled = value;
    edit.disabled = value;
    agentButton.disabled = value;
    send.textContent = value ? '応答を待っています…' : '送信';
  }

  function discardDocumentProposal() {
    proposal.hidden = true;
    proposalText.value = '';
    proposalSource = null;
  }

  async function discardAgentProposal() {
    if (agentResult) await invoke('discard_agent_run', { id: agentResult.id }).catch(() => {});
    agentResult = null;
    agentFolder = null;
    agentFiles.replaceChildren();
    agentReview.hidden = true;
  }

  function renderAgentProposal(result: AgentRun) {
    agentFiles.replaceChildren();
    result.proposals.forEach((item, index) => {
      const details = document.createElement('details');
      details.className = 'agent-file';
      details.open = index === 0;
      const summary = document.createElement('summary');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = true;
      check.value = item.path;
      check.setAttribute('aria-label', `${item.path} を適用`);
      check.addEventListener('click', (event) => event.stopPropagation());
      summary.append(check, document.createTextNode(`${item.original === null ? '新規' : '編集'}: ${item.path}`));
      const diff = document.createElement('pre');
      diff.className = 'agent-diff';
      for (const part of diffLines(item.original ?? '', item.content)) {
        const span = document.createElement('span');
        span.className = part.added ? 'diff-added' : part.removed ? 'diff-removed' : '';
        span.textContent = part.value;
        diff.append(span);
      }
      details.append(summary, diff);
      agentFiles.append(details);
    });
    agentReview.hidden = false;
  }

  toggle.addEventListener('click', () => show(panel.hasAttribute('hidden')));
  document.getElementById('claude-close')!.addEventListener('click', () => show(false));
  document.getElementById('claude-discard')!.addEventListener('click', discardDocumentProposal);
  document.getElementById('claude-apply')!.addEventListener('click', () => {
    if (!proposalSource) return;
    const current = getDocument();
    if (current.id !== proposalSource.id || current.markdown !== proposalSource.markdown) {
      addMessage('error', '文書が変わりました。変更案を作り直してください。');
      discardDocumentProposal();
      return;
    }
    applyDocument(proposalText.value);
    addMessage('assistant', '変更案を文書に適用しました。');
    discardDocumentProposal();
  });

  if (!isTauri) {
    keyStatus.textContent = 'チャットはデスクトップ版で利用できます。';
    chatKeyState.textContent = 'チャットはデスクトップ版で利用できます。';
    keyInput.disabled = true;
    send.disabled = true;
    edit.disabled = true;
    agentButton.disabled = true;
    (document.getElementById('claude-save-key') as HTMLButtonElement).disabled = true;
    (document.getElementById('claude-session-key') as HTMLButtonElement).disabled = true;
    (document.getElementById('claude-clear-key') as HTMLButtonElement).disabled = true;
    return;
  }

  async function refreshKeyStatus() {
    try {
      const status = await invoke<KeyStatus>('claude_key_status');
      keyStatus.textContent = {
        keychain: 'システムキーチェーンに保存済みです。次回も使えます。',
        session: '今回の起動中だけ利用します。',
        environment: '環境変数 ANTHROPIC_API_KEY を使用しています。',
        none: status.keychainError ? 'キーチェーンを利用できません。解除するか「今回だけ使う」を選んでください。' : 'API キーを入力して「保存する」を押してください。',
      }[status.source];
      chatKeyState.textContent = status.source === 'none' ? 'Claude API キーは「設定」から登録できます。' : '接続先: Claude · API キー設定済み';
    } catch (error) {
      keyStatus.textContent = `API キーの状態を確認できませんでした: ${String(error)}`;
    }
  }

  void refreshKeyStatus();

  async function saveKey(persist: boolean) {
    if (!keyInput.value.trim()) { keyStatus.textContent = 'Claude API キーを入力してください。'; return; }
    try {
      await invoke('set_claude_key', { key: keyInput.value, persist });
      keyInput.value = '';
      await refreshKeyStatus();
    } catch (error) {
      keyStatus.textContent = String(error);
    }
  }

  document.getElementById('claude-save-key')!.addEventListener('click', () => void saveKey(true));
  document.getElementById('claude-session-key')!.addEventListener('click', () => void saveKey(false));
  document.getElementById('claude-clear-key')!.addEventListener('click', async () => {
    try {
      await invoke('clear_claude_key');
      keyInput.value = '';
      await refreshKeyStatus();
    } catch (error) {
      keyStatus.textContent = String(error);
    }
  });

  void listen<string>('document-agent-progress', (event) => {
    if (agentBusy) progress.textContent = event.payload;
  });

  question.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send.click(); }
  });

  async function submit(editing: boolean) {
    if (busy || !question.value.trim()) return;
    const snapshot = getDocument();
    const request = question.value.trim();
    if (conversationTab !== snapshot.id) { conversation = []; conversationTab = snapshot.id; }
    question.value = '';
    addMessage('user', `${editing ? '変更案' : '質問'}: ${request}`);
    setBusy(true);
    try {
      const answer = await invoke<string>('ask_claude', {
        document: snapshot.markdown,
        question: request,
        mode: editing ? 'edit' : 'ask',
        model: model.value,
        history: editing ? [] : conversation,
      });
      if (editing) {
        if (getDocument().id !== snapshot.id || getDocument().markdown !== snapshot.markdown) {
          addMessage('error', '応答中に文書が変わったため、変更案は適用できません。');
        } else {
          proposalSource = snapshot;
          proposalText.value = answer;
          proposal.hidden = false;
          addMessage('assistant', '変更案を作成しました。内容を確認してから適用してください。');
        }
      } else {
        addMessage('assistant', answer);
        conversation.push({ content: request }, { content: answer });
        conversation = conversation.slice(-8);
      }
    } catch (error) {
      addMessage('error', String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runAgent() {
    if (busy || !question.value.trim()) return;
    const workspace = getWorkspace();
    if (!workspace.folder) { addMessage('error', '先にフォルダを開いてください。'); return; }
    if (workspace.dirtyPaths.length) { addMessage('error', '開いているフォルダ内に未保存の文書があります。先に保存してください。'); return; }
    await discardAgentProposal();
    const request = question.value.trim();
    const snapshot = getDocument();
    if (conversationTab !== snapshot.id) { conversation = []; conversationTab = snapshot.id; }
    question.value = '';
    addMessage('user', `フォルダ作業: ${request}`);
    setBusy(true);
    agentBusy = true;
    progress.hidden = false;
    progress.textContent = 'フォルダ内を調べています…';
    try {
      const result = await invoke<AgentRun>('run_document_agent', {
        folder: workspace.folder,
        question: request,
        model: model.value,
        history: conversation,
      });
      addMessage('assistant', result.message);
      conversation.push({ content: request }, { content: result.message });
      conversation = conversation.slice(-8);
      if (result.steps.length) addMessage('assistant', `実行した操作: ${result.steps.join(' → ')}`);
      if (result.proposals.length) {
        agentResult = result;
        agentFolder = workspace.folder;
        renderAgentProposal(result);
      }
    } catch (error) {
      addMessage('error', String(error));
      question.value = request;
    } finally {
      agentBusy = false;
      progress.hidden = true;
      setBusy(false);
    }
  }

  document.getElementById('agent-apply')!.addEventListener('click', async () => {
    if (!agentResult || !agentFolder || busy) return;
    const workspace = getWorkspace();
    if (workspace.folder !== agentFolder) { addMessage('error', '開いたフォルダが変わりました。変更案を作り直してください。'); return; }
    if (workspace.dirtyPaths.length) { addMessage('error', '未保存の文書を保存してから適用してください。'); return; }
    const selectedPaths = [...agentFiles.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((input) => input.value);
    if (!selectedPaths.length) { addMessage('error', '適用するファイルを選んでください。'); return; }
    setBusy(true);
    try {
      await invoke('apply_agent_edits', { id: agentResult.id, paths: selectedPaths });
      const selected = agentResult.proposals.filter((item) => selectedPaths.includes(item.path));
      onAgentApplied(agentFolder, selected);
      addMessage('assistant', `${selected.length} 件の変更を適用しました。`);
      agentResult = null;
      agentFolder = null;
      agentFiles.replaceChildren();
      agentReview.hidden = true;
    } catch (error) {
      addMessage('error', String(error));
    } finally {
      setBusy(false);
    }
  });
  document.getElementById('agent-discard')!.addEventListener('click', () => void discardAgentProposal());
  send.addEventListener('click', () => void submit(false));
  edit.addEventListener('click', () => void submit(true));
  agentButton.addEventListener('click', () => void runAgent());
}
