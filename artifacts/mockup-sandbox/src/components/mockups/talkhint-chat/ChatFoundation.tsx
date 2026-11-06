import { useRef, useState } from "react";
import {
  ArrowUp, AudioLines, ChevronLeft, FileText, Image, Menu, Mic, MoreHorizontal,
  Paperclip, Plus, Search, Settings2, X, Sparkles, Languages, MessageCircle, UserRound, History,
} from "lucide-react";
import "./_group.css";

type Turn = { id: number; role: "user" | "assistant"; text: string; files?: string[] };
type PreviewFile = { id: number; name: string; status: "uploading" | "ready" };
type Thread = { id: number; title: string; time: string; turns: Turn[] };

const initialThreads: Thread[] = [
  {
    id: 1, title: "Find a quiet place for dinner", time: "Today",
    turns: [
      { id: 11, role: "user", text: "Could you help me find a quiet place for dinner tonight? Somewhere near the river, not too formal." },
      { id: 12, role: "assistant", text: "Of course. What time should I look for, and is there a particular cuisine you prefer?" },
      { id: 13, role: "user", text: "Around 7:30. Mediterranean would be lovely." },
      { id: 14, role: "assistant", text: "Got it: a relaxed Mediterranean spot near the river, around 7:30. I can help narrow down the options." },
    ],
  },
  { id: 2, title: "A note for my landlord", time: "Yesterday", turns: [
    { id: 21, role: "user", text: "Help me write a polite note about the kitchen tap." },
    { id: 22, role: "assistant", text: "Sure. Tell me what is happening with it and what you would like your landlord to do." },
  ] },
  { id: 3, title: "Weekend ideas with the kids", time: "Mon", turns: [
    { id: 31, role: "user", text: "Any low-key ideas for Saturday?" },
  ] },
];

const futureSections = ["Calendar", "Notebook", "Tasks", "Files", "Mail", "My card", "Connections", "Tariff"];

export function ChatFoundation() {
  const [threads, setThreads] = useState(initialThreads);
  const [active, setActive] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [fileError, setFileError] = useState("");
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const current = threads.find((thread) => thread.id === active) ?? threads[0];

  function createThread() {
    const thread = { id: Date.now(), title: "New conversation", time: "Now", turns: [] as Turn[] };
    setThreads((items) => [thread, ...items]);
    setActive(thread.id);
    setDraft("");
    setFiles([]);
    setFileError("");
    setDrawerOpen(false);
  }
  function selectThread(id: number) {
    setActive(id);
    setDrawerOpen(false);
    setFiles([]);
  }
  function send() {
    const text = draft.trim();
    if (!text && !files.length) return;
    if (files.some((file) => file.status !== "ready")) {
      setToast("Wait until the attachment is ready.");
      window.setTimeout(() => setToast(""), 3200);
      return;
    }
    const turn: Turn = { id: Date.now(), role: "user", text, files: files.map((file) => file.name) };
    setThreads((items) => items.map((thread) => thread.id === active
      ? { ...thread, title: thread.turns.length ? thread.title : (text || files[0]?.name || "").slice(0, 35), turns: [...thread.turns, turn] }
      : thread));
    setDraft("");
    setFiles([]);
    setToast("Preview only — your message was not sent to an assistant.");
    window.setTimeout(() => setToast(""), 3200);
  }
  function startVoice() {
    if (recording) {
      setRecording(false);
      setEditingTranscript(true);
      setDraft("Could you help me plan something for this week?");
      return;
    }
    setRecording(true);
    setEditingTranscript(false);
  }

  return (
    <main className="th-chat">
      <div className="th-shell">
        <header className="th-header">
          <button className="th-icon-button" aria-label="Open recent conversations" onClick={() => setDrawerOpen(true)}><Menu size={20} /></button>
          <div className="th-brand"><span className="th-mark"><AudioLines size={17} /></span><span>TalkHint</span></div>
          <button className="th-icon-button" aria-label="Start a new chat" onClick={createThread}><Plus size={20} /></button>
        </header>

        <div className="th-title-row">
          <div><p className="th-kicker">YOUR SPACE</p><h1>{current?.title || "A little help, right here"}</h1></div>
          <button className="th-more" aria-label="Conversation options" onClick={() => setToast("Conversation management will be added in a later stage. This is an interface preview.")}><MoreHorizontal size={20} /></button>
        </div>
        <div className="th-notice"><span className="th-status-dot" /> Interface preview <span className="th-notice-sep">·</span> no AI requests</div>

        <section className="th-transcript" aria-label="Simulated sample conversation">
          <div className="th-sample-label"><span>SIMULATED SAMPLE CONVERSATION</span><i /></div>
          {!current?.turns.length && (
            <div className="th-empty">
              <div className="th-orbit"><AudioLines size={24} /></div>
              <h2>What do you need?</h2>
              <p>Tell me naturally. We can figure it out together.</p>
              <button onClick={() => setDraft("Help me make a plan for the week")}>Help me make a plan for the week <ChevronLeft size={15} /></button>
            </div>
          )}
          {current?.turns.map((turn) => (
            <article className={`th-turn ${turn.role}`} key={turn.id}>
              {turn.role === "assistant" && <span className="th-avatar"><AudioLines size={15} /></span>}
              <div className="th-bubble">
                {turn.text && <p>{turn.text}</p>}
                {turn.files?.map((name) => <div className="th-file-chip" key={name}><FileText size={15} /><span>{name}</span></div>)}
              </div>
            </article>
          ))}
          {recording && (
            <div className="th-recording"><span className="th-live-dot" /><div><strong>Listening</strong><small>Your words will appear here to review</small></div><span className="th-wave"><i /><i /><i /><i /><i /><i /><i /></span></div>
          )}
          {editingTranscript && (
            <div className="th-editing">
              <div className="th-editing-heading"><AudioLines size={15} /> Voice draft <span>EDIT BEFORE SENDING</span></div>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Edit voice transcript" />
              <div className="th-editing-actions"><button onClick={() => { setEditingTranscript(false); setDraft(""); }}>Discard</button><button className="th-keep" onClick={() => setEditingTranscript(false)}>Keep draft</button></div>
            </div>
          )}
        </section>

        <div className="th-composer-wrap">
          {fileError && <div className="th-file-preview error"><span className="th-file-icon"><FileText size={16} /></span><span className="th-file-name">{fileError}</span><span className="th-file-state">Too large</span><button aria-label="Dismiss file error" onClick={() => setFileError("")}><X size={15} /></button></div>}
          {files.map((file) => <div className="th-file-preview" key={file.id}><span className="th-file-icon"><FileText size={16} /></span><span className="th-file-name">{file.name}</span><span className={`th-file-state ${file.status}`}>{file.status === "ready" ? "Ready" : "Uploading…"}</span><button aria-label={`Remove ${file.name}`} onClick={() => setFiles((items) => items.filter((item) => item.id !== file.id))}><X size={15} /></button></div>)}
          <div className="th-composer">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
              placeholder="Write a message…"
              aria-label="Write a message"
              rows={1}
            />
            <div className="th-compose-actions">
              <div className="th-attach-actions">
                <button aria-label="Attach a file" onClick={() => fileInput.current?.click()}><Paperclip size={18} /></button>
                <button aria-label="Attach a photo" onClick={() => fileInput.current?.click()}><Image size={17} /></button>
                <input ref={fileInput} type="file" accept=".txt,.png,.jpg,.jpeg,.pdf" multiple hidden onChange={(event) => {
                  const selectedFiles = Array.from(event.target.files ?? []);
                  const remaining = Math.max(0, 3 - files.length);
                  if (selectedFiles.length > remaining) { setToast("Up to three files per message."); window.setTimeout(() => setToast(""), 3200); }
                  const accepted = selectedFiles.slice(0, remaining);
                  const valid = accepted.filter((selected) => {
                    if (selected.size <= 2 * 1024 * 1024) return true;
                    setFileError(selected.name);
                    return false;
                  });
                  const started = valid.map((selected, index) => ({ id: Date.now() + index, name: selected.name, status: "uploading" as const }));
                  setFiles((items) => [...items, ...started]);
                  started.forEach((upload) => window.setTimeout(() => {
                    setFiles((items) => items.map((item) => item.id === upload.id ? { ...item, status: "ready" } : item));
                  }, 550));
                  event.target.value = "";
                }} />
                <span className="th-composer-hint">A thought, a question, anything</span>
              </div>
              <div className="th-send-actions">
                <button className={`th-voice ${recording ? "active" : ""}`} aria-label={recording ? "Stop recording" : "Record voice message"} onClick={startVoice}><Mic size={18} /></button>
                <button className="th-send" aria-label="Add message to preview" onClick={send}><ArrowUp size={18} /></button>
              </div>
            </div>
          </div>
          {editingTranscript && <div className="th-transcript-foot">Review and edit your voice draft before you choose to send it.</div>}
        </div>
        <footer className="th-footer"><span>Private conversation</span><span>·</span><button onClick={() => setToast("Language follows your iPhone settings.")}>Language follows iPhone <Settings2 size={13} /></button></footer>
        <nav className="th-tabs" aria-label="TalkHint navigation preview">
          {[
            { label: "Hint", Icon: Sparkles }, { label: "Translator", Icon: Languages },
            { label: "Chat", Icon: MessageCircle }, { label: "Secretary", Icon: UserRound },
            { label: "History", Icon: History },
          ].map(({ label, Icon }) => <button key={label} className={label === "Chat" ? "selected" : ""}
            aria-current={label === "Chat" ? "page" : undefined}
            onClick={() => {
              if (label !== "Chat") setToast(`${label} remains in the native app. This preview demonstrates Chat only.`);
              else setToast("");
            }}><span><Icon size={19} /></span>{label}</button>)}
        </nav>
        {toast && <div className="th-toast" role="status">{toast}</div>}

        {drawerOpen && <>
          <button className="th-scrim" aria-label="Close recent conversations" onClick={() => setDrawerOpen(false)} />
          <aside className="th-drawer">
            <div className="th-drawer-head"><div><p className="th-kicker">TALKHINT</p><h2>Your conversations</h2></div><button className="th-icon-button" aria-label="Close" onClick={() => setDrawerOpen(false)}><X size={19} /></button></div>
            <button className="th-new-conversation" onClick={createThread}><Plus size={17} /> New conversation</button>
            <div className="th-search"><Search size={15} /><span>Find a conversation</span><kbd>⌘ K</kbd></div>
            <p className="th-section-label">RECENTS</p>
            <div className="th-thread-list">{threads.map((thread) => <button key={thread.id} className={`th-thread ${active === thread.id ? "selected" : ""}`} onClick={() => selectThread(thread.id)}><span className="th-thread-icon"><AudioLines size={16} /></span><span className="th-thread-main"><strong>{thread.title}</strong><small>{thread.time}</small></span><MoreHorizontal size={16} /></button>)}</div>
            <div className="th-drawer-bottom">
              {futureSections.map((section, index) => <button className="th-future-link" key={section} onClick={() => setToast(`${section} is not available yet.`)}><span className="th-future-icon">{["◷", "▤", "✓", "▧", "✉", "◉", "⌁", "◇"][index]}</span>{section}<span>Coming later</span></button>)}
              <button className="th-settings-link" onClick={() => setToast("Settings open in the TalkHint app.")}><Settings2 size={16} /> Settings</button>
            </div>
          </aside>
        </>}
      </div>
    </main>
  );
}

export default ChatFoundation;
