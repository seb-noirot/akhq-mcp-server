import type { Environment } from './config.js';

/** In-memory store: environment name -> active bearer token. */
export type TokenStore = Map<string, string>;

export function buildAuthHeaders(
  env: Environment,
  tokenStore: TokenStore,
): Record<string, string> {
  const { auth } = env;
  if (auth.type === 'basic') {
    const encoded = Buffer.from(auth.username + ':' + auth.password).toString('base64');
    return { Authorization: 'Basic ' + encoded };
  }
  if (auth.type === 'bearer') {
    const token = tokenStore.get(env.name);
    if (!token) return {};
    return { Authorization: 'Bearer ' + token };
  }
  return {};
}

export function parameterizeEndpoint(
  endpoint: string,
  parameters: Record<string, unknown>,
): string {
  let path = endpoint.replace(/\{([^}]+)\}/g, (_match, paramName: string) => {
    const value = parameters[paramName];
    if (value === undefined || value === null) {
      throw new Error('Missing required parameter: ' + paramName);
    }
    return encodeURIComponent(String(value));
  });

  const queryParams = Object.entries(parameters)
    .filter(([key]) => !endpoint.includes('{' + key + '}'))
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return (value as unknown[])
          .map((v) => encodeURIComponent(key) + '=' + encodeURIComponent(String(v)))
          .join('&');
      }
      return encodeURIComponent(key) + '=' + encodeURIComponent(String(value));
    })
    .join('&');

  if (queryParams) {
    path += '?' + queryParams;
  }
  return path;
}

export async function callApi(
  env: Environment,
  tokenStore: TokenStore,
  endpoint: string,
  method: string,
  body?: unknown,
  contentType?: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const headers: Record<string, string> = {
    ...buildAuthHeaders(env, tokenStore),
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(env.baseUrl + endpoint, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data: unknown;
  const ct = response.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (response.status === 401 || response.status === 403) {
    if (env.auth.type === 'bearer') {
      tokenStore.delete(env.name);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: '****** expired or unauthorized (HTTP ' + response.status + ')',
              action_required: 'Call set_bearer_token with environment "' + env.name + '" and a fresh token to continue.',
            }),
          },
        ],
      };
    }
  }

  if (!response.ok) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'HTTP ' + response.status, details: data }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data),
      },
    ],
  };
}
