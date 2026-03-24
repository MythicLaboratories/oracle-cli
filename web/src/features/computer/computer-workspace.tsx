import { useState, useCallback } from "react";
import { Monitor, X, Terminal } from "lucide-react";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TerminalPanel } from "./terminal-panel";
import { ComputerChat } from "./computer-chat";

interface ComputerSession {
  id: string;
  title: string;
  createdAt: number;
}

const SESSIONS_KEY = "mythic-computer-sessions";

function loadSessions(): ComputerSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ComputerSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

interface ComputerWorkspaceProps {
  onClose: () => void;
}

export function ComputerWorkspace({ onClose }: ComputerWorkspaceProps) {
  const [sessions, setSessions] = useState<ComputerSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => sessions[0]?.id ?? null,
  );

  const createSession = useCallback(() => {
    const session: ComputerSession = {
      id: `cs-${Date.now()}`,
      title: `Session ${sessions.length + 1}`,
      createdAt: Date.now(),
    };
    const next = [session, ...sessions];
    setSessions(next);
    saveSessions(next);
    setActiveSessionId(session.id);
  }, [sessions]);

  const deleteSession = useCallback(
    (id: string) => {
      const next = sessions.filter((s) => s.id !== id);
      setSessions(next);
      saveSessions(next);
      localStorage.removeItem(`mythic-chat-${id}`);
      if (activeSessionId === id) {
        setActiveSessionId(next[0]?.id ?? null);
      }
    },
    [sessions, activeSessionId],
  );

  // Auto-create first session if none exist
  if (sessions.length === 0) {
    const session: ComputerSession = {
      id: `cs-${Date.now()}`,
      title: "Session 1",
      createdAt: Date.now(),
    };
    setSessions([session]);
    saveSessions([session]);
    setActiveSessionId(session.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0f]">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-[#1a1a2e] px-4 py-2 shrink-0 bg-[#0d0d14]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Monitor className="size-4 text-[#39ff14]" />
            <span className="text-sm font-bold text-white tracking-wide">
              Mythic Terminal
            </span>
          </div>
          <span className="text-[10px] text-[#666680] rounded bg-[#1a1a2e] px-1.5 py-0.5 font-mono">
            Terminal + AI
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Session tabs */}
          <div className="flex items-center gap-1 mr-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSessionId(s.id)}
                className={`group flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  activeSessionId === s.id
                    ? "bg-[#1a1a2e] text-[#39ff14]"
                    : "text-[#666680] hover:text-[#999] hover:bg-[#111118]"
                }`}
              >
                <Terminal className="size-3" />
                {s.title}
                {sessions.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(s.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        deleteSession(s.id);
                      }
                    }}
                    className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                  >
                    <X className="size-3" />
                  </span>
                )}
              </button>
            ))}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={createSession}
                  className="inline-flex size-6 items-center justify-center rounded text-[#666680] transition-colors hover:bg-[#1a1a2e] hover:text-[#39ff14]"
                >
                  <span className="text-sm font-bold">+</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New session</TooltipContent>
            </Tooltip>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-md text-[#666680] transition-colors hover:bg-[#1a1a2e] hover:text-white"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Split pane: Terminal (left) + Chat (right) */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          {/* Left: Terminal */}
          <ResizablePanel id="computer-terminal" defaultSize={55} minSize={30}>
            <TerminalPanel />
          </ResizablePanel>

          <ResizableHandle
            withHandle
            className="bg-[#1a1a2e] data-[resize-handle-active]:bg-[#39ff14]/20"
          />

          {/* Right: Chat */}
          <ResizablePanel id="computer-chat" defaultSize={45} minSize={25}>
            <ComputerChat sessionId={activeSessionId} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
