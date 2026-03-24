export interface IntegrationInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  error: string | null;
  installed: boolean;
  version: string | null;
}

export interface IntegrationEvent {
  type: string;
  status?: string;
  error?: string;
  content?: string;
  prompt?: string;
  text?: string;
  event?: Record<string, unknown>;
  message?: {
    role: string;
    content: string;
    source: string;
    timestamp: number;
  };
}
