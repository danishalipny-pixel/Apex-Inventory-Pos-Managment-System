// Test HTTP Client Helper using native fetch
class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async get(endpoint) {
    const res = await fetch(`${this.baseUrl}${endpoint}`);
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }

  async post(endpoint, body) {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }

  async put(endpoint, body) {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }

  async delete(endpoint) {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'DELETE'
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }
}

module.exports = { ApiClient };
