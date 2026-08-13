const API_ROOT = process.env.GITHUB_API_URL || "https://api.github.com";

function authHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "cwbj-faq-publisher",
  };
}

export async function apiRequest(token, method, path, body) {
  const response = await fetch(path.startsWith("http") ? path : `${API_ROOT}${path}`, {
    method,
    headers: {
      ...authHeaders(token),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${method} ${path} が失敗しました (${response.status}): ${detail.slice(0, 500)}`);
  }
  return { data: response.status === 204 ? null : await response.json(), response };
}

/** Linkヘッダーを辿って全ページ取得する。 */
export async function apiPaginate(token, path) {
  const items = [];
  let url = path.startsWith("http") ? path : `${API_ROOT}${path}`;

  while (url) {
    const { data, response } = await apiRequest(token, "GET", url);
    items.push(...data);

    const link = response.headers.get("link") || "";
    const next = link.split(",").find((part) => part.includes('rel="next"'));
    url = next ? next.slice(next.indexOf("<") + 1, next.indexOf(">")) : null;
  }
  return items;
}
