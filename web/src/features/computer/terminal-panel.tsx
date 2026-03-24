import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  className?: string;
}

export function TerminalPanel({ className }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/terminal/ws`,
    );
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      terminalRef.current?.writeln(
        "\x1b[32m● Connected to terminal\x1b[0m\r",
      );
      // Send initial resize
      if (terminalRef.current) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: terminalRef.current.cols,
            rows: terminalRef.current.rows,
          }),
        );
      }
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        terminalRef.current?.write(new Uint8Array(event.data));
      } else {
        terminalRef.current?.write(event.data);
      }
    };

    ws.onclose = () => {
      terminalRef.current?.writeln("\r\n\x1b[31m● Disconnected\x1b[0m");
      // Auto-reconnect after 2s
      reconnectTimerRef.current = setTimeout(() => {
        terminalRef.current?.writeln("\x1b[33m● Reconnecting...\x1b[0m");
        connect();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 13,
      fontFamily:
        "'Iosevka', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      lineHeight: 1.35,
      letterSpacing: 0,
      theme: {
        background: "#0a0a0f",
        foreground: "#e0e0e8",
        cursor: "#39ff14",
        cursorAccent: "#0a0a0f",
        selectionBackground: "rgba(57, 255, 20, 0.15)",
        selectionForeground: "#ffffff",
        black: "#1a1a2e",
        red: "#ff5555",
        green: "#39ff14",
        yellow: "#f1fa8c",
        blue: "#6272a4",
        magenta: "#bd93f9",
        cyan: "#8be9fd",
        white: "#e0e0e8",
        brightBlack: "#44475a",
        brightRed: "#ff6e6e",
        brightGreen: "#69ff69",
        brightYellow: "#ffffa5",
        brightBlue: "#d6acff",
        brightMagenta: "#ff92df",
        brightCyan: "#a4ffff",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Write welcome banner
    terminal.writeln("");
    terminal.writeln(
      "  \x1b[1;32m▲ Mythic Terminal\x1b[0m  \x1b[90m— Real shell access\x1b[0m",
    );
    terminal.writeln(
      "  \x1b[90m  Powered by Oracle CLI\x1b[0m",
    );
    terminal.writeln("");

    // Send keystrokes to backend
    terminal.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Connect WebSocket
    connect();

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          );
        }
      } catch {
        // ignore fit errors during transitions
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      terminal.dispose();
    };
  }, [connect]);

  return (
    <div className={`flex flex-col h-full ${className ?? ""}`}>
      {/* Terminal header bar — macOS-style traffic lights */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1a1a2e] bg-[#0d0d14]">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-500/80" />
          <span className="size-2.5 rounded-full bg-yellow-500/80" />
          <span className="size-2.5 rounded-full bg-green-500/80" />
        </div>
        <span className="text-[11px] font-medium text-[#666680] ml-2 font-mono">
          terminal
        </span>
      </div>
      {/* Terminal body */}
      <div ref={containerRef} className="flex-1 min-h-0 bg-[#0a0a0f] p-1" />
    </div>
  );
}
