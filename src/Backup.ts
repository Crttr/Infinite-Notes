import { allStoredImages, restoreStoredImages } from './ImageStorage'

export const BACKUP_KEYS = [
  'infinite-notes-v1', 'infinite-notes-edges-v1', 'infinite-notes-item-links-v1',
  'infinite-notes-theme-v1', 'infinite-notes-line-defaults-v1',
  'infinite-notes-toolbar-visible',
] as const

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const LIMIT = 512 * 1024 * 1024
const UUID = /^[0-9a-f-]{36}$/i
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
  return c >>> 0
})
function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function u16(view: DataView, at: number, n: number) { view.setUint16(at, n, true) }
function u32(view: DataView, at: number, n: number) { view.setUint32(at, n, true) }
function zipFiles(entries: { name: string; bytes: Uint8Array }[]): Blob {
  const chunks: BlobPart[] = []
  const central: BlobPart[] = []
  let offset = 0
  let centralLength = 0
  for (const { name, bytes } of entries) {
    const path = encoder.encode(name)
    if (path.length > 65535 || bytes.length > 0xffffffff) throw new Error('Слишком большой файл для ZIP')
    const checksum = crc32(bytes)
    const header = new Uint8Array(30 + path.length)
    const v = new DataView(header.buffer)
    u32(v, 0, 0x04034b50); u16(v, 4, 20); u16(v, 6, 0x800)
    u32(v, 14, checksum); u32(v, 18, bytes.length); u32(v, 22, bytes.length)
    u16(v, 26, path.length); header.set(path, 30)
    chunks.push(header, bytes.slice().buffer)
    const directory = new Uint8Array(46 + path.length)
    const d = new DataView(directory.buffer)
    u32(d, 0, 0x02014b50); u16(d, 4, 20); u16(d, 6, 20); u16(d, 8, 0x800)
    u32(d, 16, checksum); u32(d, 20, bytes.length); u32(d, 24, bytes.length)
    u16(d, 28, path.length); u32(d, 42, offset); directory.set(path, 46)
    central.push(directory)
    offset += header.length + bytes.length
    centralLength += directory.length
  }
  if (entries.length > 65535) throw new Error('Слишком много файлов')
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  u32(e, 0, 0x06054b50); u16(e, 8, entries.length); u16(e, 10, entries.length)
  u32(e, 12, centralLength); u32(e, 16, offset)
  return new Blob([...chunks, ...central, end], { type: 'application/zip' })
}
function readZip(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const data = new Uint8Array(buffer)
  const view = new DataView(buffer)
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === data.length) { end = i; break }
  }
  if (end < 0) throw new Error('Файл не является корректным ZIP')
  const count = view.getUint16(end + 10, true)
  const size = view.getUint32(end + 12, true)
  const start = view.getUint32(end + 16, true)
  if (start + size > end || count > 5000) throw new Error('Повреждён каталог ZIP')
  const result = new Map<string, Uint8Array>()
  let pos = start
  let total = 0
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw new Error('Повреждён каталог ZIP')
    const method = view.getUint16(pos + 10, true)
    const flags = view.getUint16(pos + 8, true)
    const crc = view.getUint32(pos + 16, true)
    const compressed = view.getUint32(pos + 20, true)
    const uncompressed = view.getUint32(pos + 24, true)
    const nameLength = view.getUint16(pos + 28, true)
    const extra = view.getUint16(pos + 30, true)
    const comment = view.getUint16(pos + 32, true)
    const localOffset = view.getUint32(pos + 42, true)
    if (pos + 46 + nameLength + extra + comment > end || flags & 1 || method !== 0 || compressed !== uncompressed) throw new Error('Неподдерживаемый формат ZIP')
    const name = decoder.decode(data.subarray(pos + 46, pos + 46 + nameLength))
    if (result.has(name) || name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('Недопустимый путь внутри ZIP')
    if (localOffset + 30 > data.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Повреждён файл ZIP')
    const body = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
    if (body + compressed > data.length) throw new Error('Повреждён файл ZIP')
    const bytes = data.slice(body, body + compressed)
    if (crc32(bytes) !== crc) throw new Error(`Ошибка контрольной суммы: ${name}`)
    result.set(name, bytes)
    total += bytes.length
    if (total > LIMIT) throw new Error('Резервная копия превышает 512 МБ')
    pos += 46 + nameLength + extra + comment
  }
  if (pos !== start + size) throw new Error('Некорректный размер каталога ZIP')
  return result
}

type BackupManifest = {
  format: 'infinite-notes-backup'; version: 1; createdAt: string;
  storage: Record<string, string | null>; images: { id: string; file: string; type: string }[]
}
export type BackupPreview = { notes: number; edges: number; itemLinks: number; images: number; date: string }
function validate(files: Map<string, Uint8Array>): { manifest: BackupManifest; images: { id: string; blob: Blob }[]; preview: BackupPreview } {
  const bytes = files.get('manifest.json')
  if (!bytes) throw new Error('В архиве нет manifest.json')
  const m: unknown = JSON.parse(decoder.decode(bytes))
  if (!m || typeof m !== 'object') throw new Error('Некорректный манифест')
  const manifest = m as BackupManifest
  if (manifest.format !== 'infinite-notes-backup' || manifest.version !== 1 || !manifest.storage || typeof manifest.storage !== 'object' || !Array.isArray(manifest.images) || typeof manifest.createdAt !== 'string') throw new Error('Неподдерживаемая версия резервной копии')
  for (const key of BACKUP_KEYS) {
    const value = manifest.storage[key]
    if (value !== null && typeof value !== 'string') throw new Error(`Повреждены настройки: ${key}`)
  }
  const parseArray = (key: string) => {
    const parsed: unknown = JSON.parse(manifest.storage[key] || '[]')
    if (!Array.isArray(parsed)) throw new Error(`Неверные данные: ${key}`)
    return parsed as unknown[]
  }
  const notes = parseArray('infinite-notes-v1')
  const edges = parseArray('infinite-notes-edges-v1')
  const itemLinks = parseArray('infinite-notes-item-links-v1')
  if (!notes.every(n => !!n && typeof n === 'object' && typeof (n as { id?: unknown }).id === 'string' && typeof (n as { data?: { title?: unknown; content?: unknown } }).data?.title === 'string' && typeof (n as { data?: { content?: unknown } }).data?.content === 'string')) throw new Error('Некорректные заметки')
  if (!edges.every(e => !!e && typeof e === 'object' && typeof (e as { source?: unknown; target?: unknown }).source === 'string' && typeof (e as { target?: unknown }).target === 'string')) throw new Error('Некорректные связи')
  if (!itemLinks.every(l => !!l && typeof l === 'object' && typeof (l as { sourceNoteId?: unknown; targetNoteId?: unknown }).sourceNoteId === 'string' && typeof (l as { targetNoteId?: unknown }).targetNoteId === 'string')) throw new Error('Некорректные связи пунктов')
  const ids = new Set<string>()
  if (Number.isNaN(Date.parse(manifest.createdAt))) throw new Error('Некорректная дата резервной копии')
  const images = manifest.images.map(item => {
    if (!item || typeof item.id !== 'string' || !UUID.test(item.id) || ids.has(item.id) || item.file !== `images/${item.id}` || typeof item.type !== 'string' || !item.type.startsWith('image/') || item.type === 'image/svg+xml') throw new Error('Некорректный список изображений')
    ids.add(item.id)
    const file = files.get(item.file)
    if (!file || file.length > 15 * 1024 * 1024) throw new Error(`Изображение отсутствует или слишком велико: ${item.id}`)
    return { id: item.id, blob: new Blob([file.slice().buffer], { type: item.type }) }
  })
  if (files.size !== images.length + 1) throw new Error('В ZIP присутствуют лишние файлы')
  return { manifest, images, preview: { notes: notes.length, edges: edges.length, itemLinks: itemLinks.length, images: images.length, date: manifest.createdAt } }
}
export async function exportBackup(): Promise<Blob> {
  const storage: Record<string, string | null> = {}
  for (const key of BACKUP_KEYS) storage[key] = localStorage.getItem(key)
  const stored = await allStoredImages()
  const entries: { name: string; bytes: Uint8Array }[] = []
  const images: BackupManifest['images'] = []
  for (const { id, blob } of stored) {
    if (!UUID.test(id)) continue
    if (blob.size > 15 * 1024 * 1024) throw new Error('Изображение слишком велико для резервной копии')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    entries.push({ name: `images/${id}`, bytes })
    images.push({ id, file: `images/${id}`, type: blob.type })
  }
  const manifest: BackupManifest = { format: 'infinite-notes-backup', version: 1, createdAt: new Date().toISOString(), storage, images }
  entries.unshift({ name: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest, null, 2)) })
  return zipFiles(entries)
}
export async function inspectBackup(file: File) {
  if (file.size > LIMIT) throw new Error('Архив больше 512 МБ')
  return validate(readZip(await file.arrayBuffer())).preview
}
export async function importBackup(file: File): Promise<void> {
  if (file.size > LIMIT) throw new Error('Архив больше 512 МБ')
  const { manifest, images } = validate(readZip(await file.arrayBuffer()))
  // Preserve the existing localStorage snapshot if the write fails.
  const previous = Object.fromEntries(BACKUP_KEYS.map(key => [key, localStorage.getItem(key)]))
  await restoreStoredImages(images)
  try {
    for (const key of BACKUP_KEYS) {
      const value = manifest.storage[key]
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
  } catch (error) {
    for (const key of BACKUP_KEYS) {
      const value = previous[key]
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
    throw error
  }
  window.location.reload()
}
export function downloadBackup(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `InfiniteNotes_Backup_${new Date().toISOString().slice(0, 10)}.zip`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}
