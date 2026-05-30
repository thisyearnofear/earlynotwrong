export interface GroveUploadResponse {
  storage_key: string;
  gateway_url: string;
  uri: string;
  status_url?: string;
}

export interface GroveUploadOptions {
  chainId?: number;
  contentType?: string;
  apiUrl?: string;
}

const DEFAULT_GROVE_API_URL = "https://api.grove.storage";
const DEFAULT_GROVE_CHAIN_ID = 8453;

export async function uploadJsonToGrove(
  data: unknown,
  options: GroveUploadOptions = {},
): Promise<GroveUploadResponse> {
  const chainId = options.chainId ?? DEFAULT_GROVE_CHAIN_ID;
  const apiUrl = options.apiUrl ?? DEFAULT_GROVE_API_URL;
  const contentType = options.contentType ?? "application/json";
  const body = JSON.stringify(data, null, 2);

  const response = await fetch(`${apiUrl}/?chain_id=${chainId}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Grove upload failed (${response.status}): ${errorBody.slice(0, 500)}`,
    );
  }

  const upload = await response.json();
  return (Array.isArray(upload) ? upload[0] : upload) as GroveUploadResponse;
}
