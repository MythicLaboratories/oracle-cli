import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Terminal,
  CheckCircle,
  XCircle,
  Loader2,
  Plug,
  Unplug,
  ExternalLink,
  Send,
  Mic,
  MicOff,
  Puzzle,
} from "lucide-react";
import type { IntegrationInfo } from "./types";
import {
  fetchIntegrations,
  connectIntegration,
  disconnectIntegration,
  sendToIntegration,
} from "./api";

const ICON_MAP: Record<string, typeof Bot> = {
  bot: Bot,
  terminal: Terminal,
};

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  source: string;
  timestamp: number;
}

function StatusDot({ status }: { status: IntegrationInfo["status"] }) {
  const color =
    status === "connected"
      ? "bg-emerald-400"
      : status === "connecting"
        ? "bg-amber-400 animate-pulse"
        : status === "error"
          ? "bg-red-400"
          : "bg-zinc-500";
  return <span className={`inline-block size-2 rounded-full ${color}`} />;
}

// ── Setup View: one-click connect cards ──

function SetupView({
  integrations,
  onConnect,
  onDisconnect,
  actionLoading,
  onOpenChat,
}: {
  integrations: IntegrationInfo[];
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  actionLoading: string | null;
  onOpenChat: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-6">
      <p className="text-xs text-muted-foreground mb-2">
        One-click setup — connect AI agents to work as a team from this site.
      </p>
      {integrations.map((integ) => {
        const Icon = ICON_MAP[integ.icon] ?? Bot;
        const isConnected = integ.status === "connected";
        const isOracle = integ.id === "oracle-cli";
        const isLoading = actionLoading === integ.id;

        return (
          <div
            key={integ.id}
            className="flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border"
          >
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="size-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{integ.name}</span>
                <StatusDot status={integ.status} />
                {integ.version && (
                  <span className="text-[10px] text-muted-foreground/60">
                    v{integ.version}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {integ.description}
              </p>
              {integ.error && (
                <p className="text-[10px] text-red-400 mt-0.5">{integ.error}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isOracle ? (
                <span className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                  Host
                </span>
              ) : !integ.installed ? (
                <a
                  href="https://claude.ai/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-500/20"
                >
                  <ExternalLink className="size-3" /> Install
                </a>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() =>
                      isConnected
                        ? onDisconnect(integ.id)
                        : onConnect(integ.id)
                    }
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                      isConnected
                        ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                        : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : isConnected ? (
                      <Unplug className="size-3" />
                    ) : (
                      <Plug className="size-3" />
                    )}
                    {isConnected ? "Disconnect" : "Connect"}
                  </button>
                  {isConnected && (
                    <button
                      type="button"
                      onClick={() => onOpenChat(integ.id)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
                    >
                      <Send className="size-3" /> Chat
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Live Chat View: talk to Claude Code from the site ──

function ChatView({
  integrationId,
  integrationName,
  onBack,
}: {
  integrationId: string;
  integrationName: string;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);

    addMessage({
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      source: "you",
      timestamp: Date.now(),
    });

    try {
      const { response } = await sendToIntegration(integrationId, text);
      addMessage({
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: response,
        source: integrationName,
        timestamp: Date.now(),
      });
    } catch (err) {
      addMessage({
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Error: ${err instanceof Error ? err.message : "Failed to send"}`,
        source: "system",
        timestamp: Date.now(),
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, integrationId, integrationName, addMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Voice input via Web Speech API
  const toggleVoice = useCallback(() => {
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
      setListening(false);
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening]);

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; Back
        </button>
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-primary" />
          <span className="font-semibold text-sm">{integrationName}</span>
          <StatusDot status="connected" />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
            <Terminal className="size-10 opacity-30" />
            <p className="text-sm">
              Connected to <strong>{integrationName}</strong>
            </p>
            <p className="text-xs opacity-70">
              Type a message or use voice — it goes straight to{" "}
              {integrationName} in your terminal.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-secondary text-secondary-foreground rounded-bl-md"
              }`}
            >
              {msg.role === "assistant" && (
                <span className="text-[10px] font-medium text-muted-foreground block mb-1">
                  {msg.source}
                </span>
              )}
              {msg.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-border/50 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${integrationName}...`}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 max-h-32"
          />
          <button
            type="button"
            onClick={toggleVoice}
            className={`inline-flex size-8 items-center justify-center rounded-lg transition-colors ${
              listening
                ? "bg-red-500/20 text-red-400 animate-pulse"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
            title={listening ? "Stop listening" : "Voice input"}
          >
            {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dialog ──

export function IntegrationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [chatTarget, setChatTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchIntegrations();
      setIntegrations(data);
    } catch {
      // API may not be available
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setLoading(true);
      refresh();
    } else {
      setChatTarget(null);
    }
  }, [open, refresh]);

  const handleConnect = useCallback(
    async (id: string) => {
      setActionLoading(id);
      try {
        await connectIntegration(id);
        await refresh();
      } catch {
        // shown via error field
      } finally {
        setActionLoading(null);
      }
    },
    [refresh],
  );

  const handleDisconnect = useCallback(
    async (id: string) => {
      setActionLoading(id);
      try {
        await disconnectIntegration(id);
        await refresh();
      } catch {
        // silent
      } finally {
        setActionLoading(null);
      }
    },
    [refresh],
  );

  const handleOpenChat = useCallback(
    (id: string) => {
      const integ = integrations.find((i) => i.id === id);
      if (integ) setChatTarget({ id, name: integ.name });
    },
    [integrations],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-label="Close"
      />

      <div className="relative z-10 flex w-full max-w-xl flex-col rounded-2xl border border-border bg-background shadow-2xl" style={{ height: chatTarget ? "80vh" : "auto", maxHeight: "80vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <Puzzle className="size-4 text-primary" />
            <h2 className="font-semibold text-sm">Integrations</h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <XCircle className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : chatTarget ? (
            <ChatView
              integrationId={chatTarget.id}
              integrationName={chatTarget.name}
              onBack={() => setChatTarget(null)}
            />
          ) : (
            <SetupView
              integrations={integrations}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              actionLoading={actionLoading}
              onOpenChat={handleOpenChat}
            />
          )}
        </div>
      </div>
    </div>
  );
}
