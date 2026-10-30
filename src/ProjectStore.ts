// Local project catalog. Each project owns a complete .inotes snapshot in IndexedDB.
// The currently opened project is still mirrored into the legacy localStorage keys.
export type LocalProject = { id: string; name: string; createdAt: string; updatedAt: string; blob: Blob | null }
const DB = 'infinite-notes-projects-v1'
const STORE = 'projects'
export const ACTIVE_PROJECT_KEY = 'infinite-notes-active-project-id'
let opening: Promise<IDBDatabase> | undefined
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function listProjects(): Promise<LocalProject[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as LocalProject[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    req.onerror = () => reject(req.error)
  })
}
export async function putProject(project: LocalProject): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(project)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
export async function removeProject(id: string): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
export function createProject(name: string, blob: Blob | null = null): LocalProject {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, blob }
}
