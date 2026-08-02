import { API } from './client'

// ---------------- Medicine info ----------------
export async function getMedicineInfo(name) {
  const { data } = await API.get(`/medicine-info/${encodeURIComponent(name)}`)
  return data
}
