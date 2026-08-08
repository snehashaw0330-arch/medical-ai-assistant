import { API } from './client'

// ---------------- Health (used by Dashboard) ----------------
export async function getHealth() {
  const { data } = await API.get('/')
  return data
}
