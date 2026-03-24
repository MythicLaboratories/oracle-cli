import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Terminal,
  CheckCircle,
  XCircle,
  Loader2,
  Plug,
  Unplug,
  ExternalLink,
} from "lucide-react";
import type { IntegrationInfo } from "./types";
import {
  fetchIntegrations,
  connectIntegration,
  disconnectIntegration,
} from "./api";

const ICON_MAP: Record<string, typeof Bot> = {
  bot: Bot,
  terminal: Terminal,
};

function StatusBadge({ status }: { status: IntegrationInfo["status"] }) {
  switch (status) {
    case "connected":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
          <CheckCircle className="size-3" /> Connected
        </span>
      );
    case "connecting":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
          <Loader2 className="size-3 animate-spin" /> Connecting
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
          <XCircle className="size-3" /> Error
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs font-medium text-zinc-400">
          <Unplug className="size-3" /> Disconnected
        </span>
      );
  }
}

function IntegrationCard({
  integration,
  onConnect,
  onDisconnect,
  isLoading,
}: {
  integration: IntegrationInfo;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  isLoading: boolean;
}) {
  const Icon = ICON_MAP[integration.icon] ?? Bot;
  const isConnected = integration.status === "connected";
  const isOracle = integration.id === "oracle-cli";

  return (
    <div className="flex items-start gap-4 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-6 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">{integration.name}</h3>
          <StatusBadge status={integration.status} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {integration.description}
        </p>
        {integration.version && (
          <p className="mt-1 text-xs text-muted-foreground/70">
            v{integration.version}
          </p>
        )}
        {integration.error && (
          <p className="mt-1 text-xs text-red-400">{integration.error}</p>
        )}
      </div>
      <div className="shrink-0">
        {isOracle ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
            <Bot className="size-3" /> Host
          </span>
        ) : integration.installed ? (
          <button
            type="button"
            disabled={isLoading}
            onClick={() =>
              isConnected
                ? onDisconnect(integration.id)
                : onConnect(integration.id)
            }
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isConnected
                ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            } disabled:opacity-50`}
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
        ) : (
          <a
            href={
              integration.id === "claude-code"
                ? "https://claude.ai/download"
                : "#"
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/20"
          >
            <ExternalLink className="size-3" /> Install
          </a>
        )}
      </div>
    </div>
  );
}

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

  const refresh = useCallback(async () => {
    try {
      const data = await fetchIntegrations();
      setIntegrations(data);
    } catch {
      // Silently fail — integrations API may not be available
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setLoading(true);
      refresh();
    }
  }, [open, refresh]);

  const handleConnect = useCallback(
    async (id: string) => {
      setActionLoading(id);
      try {
        await connectIntegration(id);
        await refresh();
      } catch {
        // Error shown via integration.error
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
        // Silently fail
      } finally {
        setActionLoading(null);
      }
    },
    [refresh],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-label="Close"
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Integrations</h2>
            <p className="text-xs text-muted-foreground">
              Connect AI agents to work as a team
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <XCircle className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {integrations.map((integration) => (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  onConnect={handleConnect}
                  onDisconnect={handleDisconnect}
                  isLoading={actionLoading === integration.id}
                />
              ))}

              {integrations.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No integrations available
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/50 px-6 py-3">
          <p className="text-center text-xs text-muted-foreground">
            Connected agents share context and work together as a team
          </p>
        </div>
      </div>
    </div>
  );
}
