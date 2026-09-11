export async function workspaceFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401) window.dispatchEvent(new Event("meddesk:sign-in-required"));
  return response;
}
