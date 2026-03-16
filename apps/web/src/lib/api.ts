/**
 * Athena V2 - API Client
 * Central Axios instance with JWT auth header injection.
 * All API calls go through this instance.
 */

import axios from 'axios';

const baseURL =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  import.meta.env.VITE_API_URL?.trim() ||
  '/api';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the JWT token from localStorage on every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('athena_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If we get a 401 (unauthorized), token is expired — clear auth and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('athena_token');
      localStorage.removeItem('athena_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
