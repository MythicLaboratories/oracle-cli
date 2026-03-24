import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  Mic,
  MicOff,
  Monitor,
  Loader2,
  Trash2,
} from "lucide-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

function loadMessages(sessionId: string | null): ChatMessage[] {
  if (!sessionId) return [];
  try {
    const raw = localStorage.getItem(`mythic-chat-${sessionId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages(sessionId: string | null, messages: ChatMessage[]) {
  if (!sessionId) return;
  localStorage.setItem(`mythic-chat-${sessionId}`, JSON.stringify(messages));
}

interface ComputerChatProps {
  sessionId: string | null;
}

export function ComputerChat({ sessionId }: ComputerChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadMessages(sessionId),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [listening, setListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reload messages when session changes
  useEffect(() => {
    setMessages(loadMessages(sessionId));
  }, [sessionId]);

  // Persist messages on change
  useEffect(() => {
    saveMessages(sessionId, messages);
  }, [sessionId, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [sessionId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    if (sessionId) localStorage.removeItem(`mythic-chat-${sessionId}`);
  }, [sessionId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    setStreamContent("");

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // Try SSE streaming first
      const res = await fetch("/api/integrations/claude-code/send-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, share_context: true }),
      });

      if (!res.ok) {
        // Fallback to regular send
        const fallbackRes = await fetch("/api/integrations/claude-code/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, share_context: true }),
        });
        if (!fallbackRes.ok) throw new Error("Failed to send");
        const { response } = await fallbackRes.json();
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: response,
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      // Stream SSE response
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "done") break;

              if (event.type === "content_block_delta") {
                fullText += event.delta?.text ?? "";
                setStreamContent(fullText);
              } else if (event.type === "assistant" && event.message?.content) {
                for (const block of event.message.content) {
                  if (block.type === "text") {
                    fullText += block.text;
                    setStreamContent(fullText);
                  }
                }
              } else if (event.type === "result" && event.result) {
                fullText = event.result;
                setStreamContent(fullText);
              } else if (typeof event.content === "string") {
                fullText += event.content;
                setStreamContent(fullText);
              }
            } catch {
              if (jsonStr !== "[DONE]") {
                fullText += jsonStr;
                setStreamContent(fullText);
              }
            }
          }
        }
      }

      const finalContent = fullText.trim() || "Done.";
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: finalContent,
          timestamp: Date.now(),
        },
      ]);
      setStreamContent("");
    } catch (err) {
      setStreamContent("");
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Failed to send"}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const toggleVoice = useCallback(() => {
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

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
    <div className="flex flex-col h-full bg-[#0d0d14]">
      {/* Chat header */}
      <div className="flex items-center justify-between border-b border-[#1a1a2e] px-4 py-2.5 shrink-0 bg-[#0d0d14]">
        <div className="flex items-center gap-2">
          <Monitor className="size-4 text-[#39ff14]" />
          <span className="font-semibold text-sm text-white">Oracle AI</span>
          <span className="size-2 rounded-full bg-[#39ff14]" />
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearMessages}
            className="inline-flex size-7 items-center justify-center rounded-md text-[#444] transition-colors hover:bg-[#1a1a2e] hover:text-[#888]"
            title="Clear chat"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.length === 0 && !streamContent && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-[#666680]">
            <Monitor className="size-10 opacity-30" />
            <p className="text-sm text-[#888]">
              Send commands to{" "}
              <strong className="text-[#39ff14]">Claude Code</strong>
            </p>
            <p className="text-xs opacity-70">
              Type a message or use voice — it dispatches to Claude Code working
              in your terminal.
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
                  ? "bg-[#39ff14] text-[#0a0a0f] rounded-br-md font-medium"
                  : "bg-[#1a1a2e] text-[#e0e0e8] rounded-bl-md"
              }`}
            >
              {msg.role === "assistant" && (
                <span className="text-[10px] font-medium text-[#666680] block mb-1">
                  Claude Code
                </span>
              )}
              {msg.content}
            </div>
          </div>
        ))}
        {/* Streaming content */}
        {streamContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-[#1a1a2e] text-[#e0e0e8] px-4 py-2.5 text-sm whitespace-pre-wrap">
              <span className="text-[10px] font-medium text-[#666680] block mb-1">
                Claude Code
              </span>
              {streamContent}
              <span className="inline-block w-1.5 h-4 bg-[#39ff14]/60 animate-pulse ml-0.5 align-text-bottom" />
            </div>
          </div>
        )}
        {sending && !streamContent && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-[#1a1a2e] px-4 py-2.5">
              <Loader2 className="size-4 animate-spin text-[#39ff14]" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#1a1a2e] p-3 shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-[#1a1a2e] bg-[#111118] px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Claude Code..."
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-[#e0e0e8] outline-none placeholder:text-[#444] max-h-32"
          />
          <button
            type="button"
            onClick={toggleVoice}
            className={`inline-flex size-8 items-center justify-center rounded-lg transition-colors ${
              listening
                ? "bg-red-500/20 text-red-400 animate-pulse"
                : "text-[#666680] hover:bg-[#1a1a2e] hover:text-white"
            }`}
            title={listening ? "Stop listening" : "Voice input"}
          >
            {listening ? (
              <MicOff className="size-4" />
            ) : (
              <Mic className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="inline-flex size-8 items-center justify-center rounded-lg bg-[#39ff14] text-[#0a0a0f] transition-opacity disabled:opacity-30"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
