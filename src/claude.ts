import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './platform';

type DocumentSnapshot = { id: number; name: string; markdown: string };

export function setupClaude(getDocument: () => DocumentSnapshot, applyDocument: (markdown: string) => void) {
  const panel = document.getElementById('claude-panel')!;
  const toggle = document.getElementById('btn-claude') as HTMLButtonElement;
  const keyInput = document.getElementById('claude-key') as HTMLInputElement;
  const keyStatus = document.getElementById('claude-key-status')!;
  const model = document.getElementById('claude-model') as HTMLSelectElement;
  const question = document.getElementById('claude-question') as HTMLTextAreaElement;
  const send = document.getElementById('claude-send') as HTMLButtonElement;
  const edit = document.getElementById('claude-edit') as HTMLButtonElement;
  const messages = document.getElementById('claude-messages')!;
  const proposal = document.getElementById('claude-proposal')!;
  const proposalText = document.getElementById('claude-proposal-text') as HTMLTextAreaElement;
  let proposalSource: DocumentSnapshot | null = null;
  let conversation: Array<{ content: string }> = [];
  let conversationTab: number | null = null;
  let busy = false;

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

  function discard() {
    proposal.hidden = true;
    proposalText.value = '';
    proposalSource = null;
  }

  toggle.addEventListener('click', () => show(panel.hasAttribute('hidden')));
  document.getElementById('claude-close')!.addEventListener('click', () => show(false));
  document.getElementById('claude-discard')!.addEventListener('click', discard);
  document.getElementById('claude-apply')!.addEventListener('click', () => {
    if (!proposalSource) return;
    const current = getDocument();
    if (current.id !== proposalSource.id || current.markdown !== proposalSource.markdown) {
      addMessage('error', '文書が変わりました。変更案を作り直してください。');
      discard();
      return;
    }
    applyDocument(proposalText.value);
    addMessage('assistant', '変更案を文書に適用しました。');
    discard();
  });

  if (!isTauri) {
    keyStatus.textContent = 'チャットはデスクトップ版で利用できます。';
    keyInput.disabled = true;
    send.disabled = true;
    edit.disabled = true;
    (document.getElementById('claude-save-key') as HTMLButtonElement).disabled = true;
    return;
  }

  void invoke<boolean>('claude_key_status').then((ready) => {
    keyStatus.textContent = ready ? 'API キーを設定済みです。キーはアプリ終了時に消去されます。' : 'API キーを設定してください。キーは起動中だけ保持します。';
  }).catch(() => { keyStatus.textContent = 'API キーの状態を確認できませんでした。'; });

  document.getElementById('claude-save-key')!.addEventListener('click', async () => {
    try {
      const clearing = !keyInput.value.trim();
      await invoke('set_claude_key', { key: keyInput.value });
      keyInput.value = '';
      keyStatus.textContent = clearing ? '入力した API キーを消去しました。' : 'API キーを設定しました。アプリ終了時に消去されます。';
    } catch (error) {
      keyStatus.textContent = String(error);
    }
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
    busy = true;
    send.disabled = true;
    edit.disabled = true;
    send.textContent = '応答を待っています…';
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
      busy = false;
      send.disabled = false;
      edit.disabled = false;
      send.textContent = '送信';
    }
  }
  send.addEventListener('click', () => void submit(false));
  edit.addEventListener('click', () => void submit(true));
}
