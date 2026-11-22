import { useState } from 'react'

export type NoteColor = string
export const isNoteColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)

const palettes: Record<string, { name: string; hex: string }[]> = {
  purple: [{ name: 'Слива', hex: '#594064' }, { name: 'Фиалка', hex: '#715780' }, { name: 'Лаванда', hex: '#4C466C' }, { name: 'Янтарь', hex: '#806034' }, { name: 'Коралл', hex: '#813F50' }],
  midnight: [{ name: 'Ночь', hex: '#293C5D' }, { name: 'Синий', hex: '#365578' }, { name: 'Индиго', hex: '#48476E' }, { name: 'Янтарь', hex: '#806034' }, { name: 'Коралл', hex: '#813F50' }],
  forest: [{ name: 'Хвоя', hex: '#305348' }, { name: 'Мох', hex: '#466347' }, { name: 'Шалфей', hex: '#3B6561' }, { name: 'Янтарь', hex: '#806034' }, { name: 'Коралл', hex: '#813F50' }],
  sunset: [{ name: 'Вино', hex: '#654251' }, { name: 'Терракота', hex: '#815348' }, { name: 'Слива', hex: '#68475E' }, { name: 'Синий', hex: '#344B69' }, { name: 'Олива', hex: '#52634A' }],
  light: [{ name: 'Лаванда', hex: '#66517B' }, { name: 'Сирень', hex: '#755E8E' }, { name: 'Слива', hex: '#584A71' }, { name: 'Синий', hex: '#344B69' }, { name: 'Коралл', hex: '#813F50' }],
  graphite: [{ name: 'Графит', hex: '#444D5A' }, { name: 'Сталь', hex: '#3D5865' }, { name: 'Сланец', hex: '#56566B' }, { name: 'Янтарь', hex: '#806034' }, { name: 'Коралл', hex: '#813F50' }],
}

export function NoteColorPicker({ theme, value, onChange }: {
  theme: string
  value?: string
  onChange: (color: string | undefined) => void
}) {
  const [hex, setHex] = useState(value || '#594064')
  const valid = isNoteColor(hex)
  return <div className="inotes-color-picker">
    <div className="inotes-color-swatches" aria-label="Палитра цветов заметки">
      {(palettes[theme] || palettes.purple).map(p => <button key={p.hex} type="button"
        className={`inotes-color-swatch${value?.toLowerCase() === p.hex.toLowerCase() ? ' active' : ''}`}
        onClick={() => { setHex(p.hex); onChange(p.hex) }} title={`${p.name}: ${p.hex}`} aria-label={`${p.name}: ${p.hex}`}
        style={{ backgroundColor: p.hex }} />)}
    </div>
    <label className="inotes-color-field">Свой цвет (HEX)
      <span><input value={hex} maxLength={7} placeholder="#594064" onChange={e => setHex(e.target.value)} aria-invalid={!valid}/>
      <input type="color" aria-label="Выбрать цвет" value={valid ? hex : '#594064'} onChange={e => { setHex(e.target.value); onChange(e.target.value) }}/>
      <button type="button" disabled={!valid} onClick={() => onChange(hex.toUpperCase())}>ОК</button></span>
    </label>
    <button type="button" className="inotes-color-reset" onClick={() => onChange(undefined)}>↺ Цвет темы (по умолчанию)</button>
  </div>
}
