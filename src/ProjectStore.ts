// Project snapshots stay in their original IndexedDB store. A lightweight index
// makes the project picker independent of large .inotes ZIP blobs.
export type LocalProject = { id: string; name: string; createdAt: string; updatedAt: string; blob: Blob | null }
export type ProjectSummary = Omit<LocalProject, 'blob'>
const DB = 'infinite-notes-projects-v1'
const STORE = 'projects'
const INDEX = 'project-index'
export const ACTIVE_PROJECT_KEY = 'infinite-notes-active-project-id'
let opening: Promise<IDBDatabase> | undefined
function summary(project: LocalProject): ProjectSummary {
  return { id: project.id, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt }
}
function database(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 2)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(INDEX)) {
          const index = db.createObjectStore(INDEX, { keyPath: 'id' })
          // One-time migration; never rewrite or delete the existing snapshots.
          const cursor = request.transaction!.objectStore(STORE).openCursor()
          cursor.onsuccess = () => {
            const row = cursor.result
            if (!row) return
            index.put(summary(row.value as LocalProject))
            row.continue()
          }
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => db.close()
        resolve(db)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Закройте другие окна Infinite Notes и повторите запуск'))
    }).catch(error => { opening = undefined; throw error })
  }
  return opening
}
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const req = db.transaction(INDEX, 'readonly').objectStore(INDEX).getAll()
    req.onsuccess = () => resolve((req.result as ProjectSummary[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    req.onerror = () => reject(req.error)
  })
}
export async function getProject(id: string): Promise<LocalProject | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result as LocalProject | undefined)
    req.onerror = () => reject(req.error)
  })
}
export async function putProject(project: LocalProject): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, INDEX], 'readwrite')
    tx.objectStore(STORE).put(project)
    tx.objectStore(INDEX).put(summary(project))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
export async function removeProject(id: string): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, INDEX], 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.objectStore(INDEX).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
export function createProject(name: string, blob: Blob | null = null): LocalProject {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, blob }
}
