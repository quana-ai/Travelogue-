// Use a relative path in the browser so Next.js proxy handles routing to the backend.
// This prevents ERR_CONNECTION_REFUSED when the backend port differs or is not directly
// reachable from the client's network. Falls back to absolute URL for SSR.
const API_BASE =
  typeof window !== 'undefined'
    ? '/api'
    : (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000/api');

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('travelogue_token');
}

export function setToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('travelogue_token', token);
  }
}

export function removeToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('travelogue_token');
    localStorage.removeItem('travelogue_user');
  }
}

export function getSavedUser() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('travelogue_user');
  return raw ? JSON.parse(raw) : null;
}

export function saveUser(user: any) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('travelogue_user', JSON.stringify(user));
  }
}

async function request(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Do not set Content-Type if body is FormData (browser will set multipart boundary automatically)
  if (!(typeof FormData !== 'undefined' && options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = Array.isArray(data.message)
      ? data.message.join('. ')
      : (data.message || `Request failed with status ${res.status}`);
    throw new Error(errorMsg);
  }

  return data;
}

async function requestBlob(endpoint: string) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const errorMsg = Array.isArray(data.message)
      ? data.message.join('. ')
      : (data.message || `Request failed with status ${res.status}`);
    throw new Error(errorMsg);
  }
  return res.blob();
}

export const api = {
  // Auth
  sendOtp: (contact: string, name?: string) =>
    request('/auth/otp/send', {
      method: 'POST',
      body: JSON.stringify({ contact, name }),
    }),

  verifyOtp: (contact: string, code: string) =>
    request('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ contact, code }),
    }),

  getMe: () => request('/auth/me'),

  // Views & Categories
  getViews: () => request('/views'),
  createView: (name: string) =>
    request('/views', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getCategories: () => request('/categories'),
  createCategory: (name: string, subcategories: string[] = ['General']) =>
    request('/categories', {
      method: 'POST',
      body: JSON.stringify({ name, subcategories }),
    }),

  // Bills
  uploadBill: (formData: FormData) =>
    request('/bills/upload', {
      method: 'POST',
      body: formData,
    }),

  getExtraction: (billId: string) => request(`/bills/${billId}/extraction`),

  confirmBill: (billId: string, data: any) =>
    request(`/bills/${billId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getBills: (filters: { q?: string; viewId?: string; category?: string; dateFilter?: string; fromDate?: string; toDate?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.viewId) params.set('viewId', filters.viewId);
    if (filters.category) params.set('category', filters.category);
    if (filters.dateFilter) params.set('dateFilter', filters.dateFilter);
    if (filters.fromDate) params.set('fromDate', filters.fromDate);
    if (filters.toDate) params.set('toDate', filters.toDate);
    return request(`/bills?${params.toString()}`);
  },

  moveBill: (billId: string, viewId: string) =>
    request(`/bills/${billId}/move`, {
      method: 'POST',
      body: JSON.stringify({ viewId }),
    }),

  addBillsToView: (viewId: string, billIds: string[]) =>
    request(`/views/${viewId}/bills`, {
      method: 'POST',
      body: JSON.stringify({ billIds }),
    }),

  getBillFile: (billId: string) => requestBlob(`/bills/${billId}/file`),

  // Sharing
  getOutgoingShares: () => request('/shares/outgoing'),
  getIncomingShares: () => request('/shares/incoming'),
  createShare: (data: { targetType: 'bill' | 'view'; targetId: string; recipientContact: string; expiresInDays?: number }) =>
    request('/shares', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  removeShare: (shareId: string) =>
    request(`/shares/${shareId}`, { method: 'DELETE' }),
};
