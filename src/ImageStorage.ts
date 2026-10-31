// Images are stored as binary Blobs in IndexedDB, not in localStorage.
const DB_NAME = 'infinite-notes-images-v1'
const STORE = 'images'
const PREFIX = 'infinite-image:'
const urls = new Map<string, string>()
let dbPromise: Promise<IDBDatabase> | undefined
function db(): Promise<IDBDatabase> {
  return dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export type GalleryImage = { id: string; caption: string; width?: number; x?: number; y?: number; z?: number }
export function imageRef(id: string) { return `${PREFIX}${id}` }
export function imageId(src: string) { return src.startsWith(PREFIX) ? src.slice(PREFIX.length) : null }
export async function saveImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('Выберите PNG, JPG, WebP или GIF (SVG не поддерживается).')
  if (file.size > 15 * 1024 * 1024) throw new Error('Максимальный размер изображения — 15 МБ.')
  const id = crypto.randomUUID()
  const database = await db()
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(file, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return id
}
export async function imageUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!
  const database = await db()
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const req = database.transaction(STORE).objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result as Blob | undefined)
    req.onerror = () => reject(req.error)
  })
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urls.set(id, url)
  return url
}
export async function resolveImages(root: HTMLElement) {
  const elements = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-image-id],img[src^="infinite-image:"]'))
  await Promise.all(elements.map(async img => {
    const id = img.dataset.imageId || imageId(img.getAttribute('src') || '')
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return
    img.dataset.imageId = id
    try { const url = await imageUrl(id); if (img.isConnected && url) img.src = url; else if (!url) img.alt = 'Изображение не найдено' }
    catch { img.alt = 'Не удалось загрузить изображение' }
  }))
}
export function canonicalImages(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll<HTMLImageElement>('img[data-image-id]').forEach(img => {
    const id = img.dataset.imageId
    if (id && /^[a-f0-9-]{36}$/i.test(id)) img.setAttribute('src', imageRef(id))
  })
  return doc.body.innerHTML
}
export async function hydratedImages(html: string): Promise<string> {
  const div = document.createElement('div')
  div.innerHTML = html
  // detached nodes are not eligible for resolveImages; hydrate directly.
  await Promise.all(Array.from(div.querySelectorAll<HTMLImageElement>('img[data-image-id],img[src^="infinite-image:"]')).map(async img => {
    const id = img.dataset.imageId || imageId(img.getAttribute('src') || '')
    if (!id) return
    img.dataset.imageId = id
    try { img.src = await imageUrl(id) || imageRef(id) } catch { /* preserve reference */ }
  }))
  return div.innerHTML
}

// Export and restore the complete image store for portable project backups.
export async function allStoredImages(): Promise<{ id: string; blob: Blob }[]> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const images: { id: string; blob: Blob }[] = []
    const request = database.transaction(STORE).objectStore(STORE).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { resolve(images); return }
      if (typeof cursor.key === 'string' && cursor.value instanceof Blob) images.push({ id: cursor.key, blob: cursor.value })
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
}
export async function restoreStoredImages(images: { id: string; blob: Blob }[]): Promise<void> {
  const database = await db()
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    // Keep existing images; imports overwrite matching IDs but never delete user images.
    for (const { id, blob } of images) store.put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Ошибка записи изображений'))
  })
  for (const { id } of images) {
    const url = urls.get(id)
    if (url) URL.revokeObjectURL(url)
    urls.delete(id)
  }
}

// Clear images when creating a genuinely empty workspace. Never called during backup import.
export async function clearStoredImages(): Promise<void> {
  const database = await db()
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
}
