import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { ApiError, isNetworkError, submitReport } from '../api'
import type { SubmitPayload } from '../api'
import { ErrorBox, Spinner } from '../components/ui'
import { KRAKOW, OSM_ATTR, OSM_URL, pickIcon } from '../components/mapIcon'
import { removeMyReport, randomToken, upsertMyReport, uuid } from '../storage'
import { fmtCoord } from '../labels'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

type LocSource = 'default' | 'gps' | 'map'

function ClickToPick({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}
function Recenter({ pos, nonce }: { pos: [number, number]; nonce: number }) {
  const map = useMap()
  useEffect(() => {
    if (nonce > 0) map.setView(pos, Math.max(map.getZoom(), 16))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])
  return null
}

export default function SubmitPage() {
  const navigate = useNavigate()
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [photoErr, setPhotoErr] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [pos, setPos] = useState<[number, number]>(KRAKOW)
  const [locSource, setLocSource] = useState<LocSource>('default')
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoErr, setGeoErr] = useState<string | null>(null)
  const [recenter, setRecenter] = useState(0)
  const [time, setTime] = useState(() => toLocalInput(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)
  // Frozen payload of the last attempt; a retry re-sends exactly this (same submission_key).
  const [attempt, setAttempt] = useState<SubmitPayload | null>(null)
  const busyRef = useRef(false)
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  // Any edit after a failed attempt means a new payload → new key on next submit.
  const edited = () => {
    if (attempt && !busyRef.current) setAttempt(null)
    setError(null)
  }

  const onFile = (f: File | undefined) => {
    if (!f) return
    if (!ACCEPTED.includes(f.type)) {
      setPhotoErr(`Unsupported format (${f.type || 'unknown'}). Use JPEG, PNG or WebP.`)
      return
    }
    if (f.size > MAX_BYTES) {
      setPhotoErr('Photo is larger than 10 MB.')
      return
    }
    setPhotoErr(null)
    setPhoto(f)
    setPreview(URL.createObjectURL(f))
    edited()
  }

  const clearPhoto = () => {
    setPhoto(null)
    setPreview(null)
    if (camRef.current) camRef.current.value = ''
    if (galRef.current) galRef.current.value = ''
    edited()
  }

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setGeoErr('Geolocation is not available — tap the map instead.')
      return
    }
    setGeoBusy(true)
    setGeoErr(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos([p.coords.latitude, p.coords.longitude])
        setLocSource('gps')
        setRecenter((n) => n + 1)
        setGeoBusy(false)
        edited()
      },
      (e) => {
        setGeoBusy(false)
        setGeoErr(
          e.code === e.PERMISSION_DENIED
            ? 'Location permission denied — tap the map to set the place.'
            : 'Could not get your location — tap the map to set the place.',
        )
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
  }

  const send = async (p: SubmitPayload) => {
    if (busyRef.current) return
    busyRef.current = true
    setSubmitting(true)
    setError(null)
    // Persist key + receipt token BEFORE sending so a lost response can be recovered/retried.
    upsertMyReport({
      submission_key: p.submission_key,
      receipt_token: p.receipt_token,
      created_at: new Date().toISOString(),
      description: p.description,
      latitude: p.latitude,
      longitude: p.longitude,
      incident_time: p.incident_time,
      has_photo: !!p.photo,
    })
    try {
      const res = await submitReport(p)
      upsertMyReport({
        submission_key: p.submission_key,
        receipt_token: p.receipt_token,
        id: res.id,
        last_status: res.status,
      })
      setAttempt(null)
      navigate(`/r/${res.id}`)
    } catch (e) {
      setError(e)
      const retryable = isNetworkError(e) || (e instanceof ApiError && e.status >= 500)
      if (!retryable) {
        // payload rejected (validation / key conflict): drop this attempt so the next submit is fresh
        removeMyReport(p.submission_key)
        setAttempt(null)
      }
    } finally {
      busyRef.current = false
      setSubmitting(false)
    }
  }

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault()
    if (busyRef.current) return
    const d = new Date(time)
    if (isNaN(d.getTime())) {
      setError(new Error('Please enter a valid incident time.'))
      return
    }
    const p: SubmitPayload = attempt ?? {
      submission_key: uuid(),
      receipt_token: randomToken(),
      description,
      photo,
      latitude: pos[0],
      longitude: pos[1],
      incident_time: d.toISOString(),
    }
    setAttempt(p)
    void send(p)
  }

  const canRetry = !!attempt && !!error && !submitting
  const noEvidence = !photo && !description.trim()

  return (
    <form className="page submit" onSubmit={onSubmit}>
      <header className="page-head">
        <div className="eyebrow">Incident Reporter · Kraków</div>
        <h1>Report an incident</h1>
        <p className="lede">Photo, place and time. We assess it and route it to the map or to an operator.</p>
      </header>

      {/* Photo */}
      <section className="field">
        <div className="field-label">
          <span className="step">1</span> Photo
        </div>
        {preview ? (
          <div className="photo-preview">
            <img src={preview} alt="Selected" />
            <button type="button" className="btn btn-ghost btn-sm photo-x" onClick={clearPhoto}>
              Remove
            </button>
          </div>
        ) : (
          <div className="photo-pick">
            <button type="button" className="btn btn-primary btn-xl" onClick={() => camRef.current?.click()}>
              <svg viewBox="0 0 24 24" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              Take photo
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => galRef.current?.click()}>
              Choose from gallery
            </button>
          </div>
        )}
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <input ref={galRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        {photoErr && <div className="hint hint-bad">{photoErr}</div>}
      </section>

      {/* Description */}
      <section className="field">
        <label className="field-label" htmlFor="desc">
          <span className="step">2</span> Description <span className="opt">optional</span>
        </label>
        <textarea
          id="desc"
          rows={3}
          maxLength={2000}
          placeholder="What is happening? e.g. smoke coming from a garbage container"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            edited()
          }}
        />
      </section>

      {/* Location */}
      <section className="field">
        <div className="field-label">
          <span className="step">3</span> Location
        </div>
        <button type="button" className="btn btn-secondary btn-block" onClick={locate} disabled={geoBusy}>
          {geoBusy ? <Spinner size={16} /> : (
            <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="7.5" /></svg>
          )}
          Use my current location
        </button>
        <div className="pick-map">
          <MapContainer center={pos} zoom={14} scrollWheelZoom={false} attributionControl={false}>
            <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
            <Marker position={pos} icon={pickIcon} />
            <ClickToPick
              onPick={(lat, lon) => {
                setPos([lat, lon])
                setLocSource('map')
                edited()
              }}
            />
            <Recenter pos={pos} nonce={recenter} />
          </MapContainer>
        </div>
        <div className="hint">
          <span className={`loc-src loc-${locSource}`}>
            {locSource === 'gps' ? 'GPS' : locSource === 'map' ? 'Picked on map' : 'Default — tap map to adjust'}
          </span>{' '}
          <span className="mono">{fmtCoord(pos[0], pos[1])}</span>
        </div>
        {geoErr && <div className="hint hint-warn">{geoErr}</div>}
      </section>

      {/* Time */}
      <section className="field">
        <label className="field-label" htmlFor="time">
          <span className="step">4</span> When did it happen?
        </label>
        <div className="time-row">
          <input
            id="time"
            type="datetime-local"
            value={time}
            max={toLocalInput(new Date(Date.now() + 5 * 60000))}
            onChange={(e) => {
              setTime(e.target.value)
              edited()
            }}
            required
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setTime(toLocalInput(new Date()))
              edited()
            }}
          >
            Now
          </button>
        </div>
      </section>

      {noEvidence && (
        <div className="alert alert-warn">
          <strong>No photo or description</strong>
          <span>You can still submit, but an operator will need to review it manually.</span>
        </div>
      )}

      <ErrorBox
        error={error}
        title={
          isNetworkError(error)
            ? 'Not sent — connection problem'
            : error instanceof ApiError && error.status === 409
              ? 'Submission conflict'
              : 'Could not submit'
        }
      />

      <div className="submit-bar">
        <button type="submit" className="btn btn-primary btn-xl btn-block" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner size={18} /> Sending…
            </>
          ) : canRetry ? (
            'Retry sending'
          ) : (
            'Submit report'
          )}
        </button>
        {canRetry && <div className="hint center">Retrying re-sends the same submission — it will not be counted twice.</div>}
      </div>
    </form>
  )
}
