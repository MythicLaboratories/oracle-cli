import type { IntegrationInfo } from "./types";

const BASE = "/api/integrations";

export async function fetchIntegrations(): Promise<IntegrationInfo[]> {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error("Failed to fetch integrations");
  return res.json();
}

export async function fetchIntegration(id: string): Promise<IntegrationInfo> {
  const res = await fetch(`${BASE}/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch integration ${id}`);
  return res.json();
}

export async function connectIntegration(
  id: string,
  workDir?: string,
): Promise<{ status: string; error?: string }> {
  const res = await fetch(`${BASE}/${id}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ work_dir: workDir ?? null }),
  });
  if (!res.ok) throw new Error(`Failed to connect ${id}`);
  return res.json();
}

export async function disconnectIntegration(
  id: string,
): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/${id}/disconnect`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to disconnect ${id}`);
  return res.json();
}

export async function sendToIntegration(
  id: string,
  prompt: string,
  shareContext = true,
): Promise<{ response: string }> {
  const res = await fetch(`${BASE}/${id}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, share_context: shareContext }),
  });
  if (!res.ok) throw new Error(`Failed to send to ${id}`);
  return res.json();
}

export function createIntegrationWebSocket(id: string): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${window.location.host}${BASE}/${id}/ws`);
}
