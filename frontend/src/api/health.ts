import { apiBaseUrl } from "../env";

export type HealthResponse = {
  status: string;
  environment: string;
};

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiBaseUrl}/health`);

  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}
