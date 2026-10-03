import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { ApiError, fetchSamplePhoto, getSamples, isNetworkError, submitReport } from '../api'
import type { Sample, SubmitPayload } from '../api'
import { AiModeBadge, ErrorBox, Spinner } from '../components/ui'
import { KRAKOW, OSM_ATTR, OSM_URL, pickIcon } from '../components/mapIcon'
import { useHealth, usePoll } from '../hooks'
import { removeMyReport, randomToken, upsertMyReport, uuid } from '../storage'
import { fmtCoord } from '../labels'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

type LocSource = 'default' | 'gps' | 'map'

/** Plain text with any http(s) URLs turned into links (photo credits). */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/\S+)/).map((part, i) =>
        i % 2 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  )
}

function SampleRow({ samples, busyId, onPick }: { samples: Sample[]; busyId: string | null; onPick: (s: Sample) => void }) {
  return (
    <section className="samples" aria-labelledby="samples-h">
      <div className="samples-head">
        <span id="samples-h" className="samples-title">Try a sample</span>
        <span className="muted small">Fills in the form for you</span>
      </div>
      <div className="samples-row">
        {samples.map((s) => (
          <button
            key={s.id}
            type="button"
            className="sample"
            onClick={() => onPick(s)}
            disabled={busyId !== null}
            aria-busy={busyId === s.id}
          >
            <span className="sample-thumb">
              {s.photo_url ? (
                <img src={s.photo_url} alt="" loading="lazy" />
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden><path d="M6 3h9l3 3v15H6z" /><path d="M9 10h6M9 14h6M9 18h4" /></svg>
              )}
              {busyId === s.id && (
                <span className="sample-busy">
                  <Spinner size={18} />
                </span>
              )}
            </span>
            <span className="sample-title">{s.title}</span>
            {s.recorded && (
              <span className="sample-rec" title="Real model output was recorded for this sample">
                Recorded
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

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
  const health = useHealth()
  const { data: samples } = usePoll(getSamples, null)
  const [sampleBusy, setSampleBusy] = useState<string | null>(null)
  const [sampleErr, setSampleErr] = useState<string | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [photoErr, setPhotoErr] = useState<string | null>(null)
  const [photoCredit, setPhotoCredit] = useState<string | null>(null)
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
  // (No `attempt &&` check: setting null when already null is a no-op, and it avoids a stale closure
  // when called after an await, e.g. from pickSample.)
  const edited = () => {
    if (!busyRef.current) setAttempt(null)
    setError(null)
  }

  /** `credit` is set only for bundled sample photos; a user-picked photo clears it. */
  const onFile = (f: File | undefined, credit: string | null = null): boolean => {
    if (!f) return false
    if (!ACCEPTED.includes(f.type)) {
      setPhotoErr(`Unsupported format (${f.type || 'unknown'}). Use JPEG, PNG or WebP.`)
      return false
    }
    if (f.size > MAX_BYTES) {
      setPhotoErr('Photo is larger than 10 MB.')
      return false
    }
    setPhotoErr(null)
    setPhoto(f)
    setPreview(URL.createObjectURL(f))
    setPhotoCredit(credit)
    edited()
    return true
  }

  const clearPhoto = () => {
    setPhoto(null)
    setPreview(null)
    setPhotoCredit(null)
    if (camRef.current) camRef.current.value = ''
    if (galRef.current) galRef.current.value = ''
    edited()
  }

  // Fill the whole form from a bundled sample. The photo is uploaded byte-for-byte as served,
  // so the replay assessor can match its recorded output.
  const pickSeq = useRef(0)
  const pickSample = async (s: Sample) => {
    if (busyRef.current) return
    const seq = ++pickSeq.current
    setSampleBusy(s.id)
    setSampleErr(null)
    let file: File | null = null
    try {
      if (s.photo_url) file = await fetchSamplePhoto(s)
    } catch (e) {
      if (seq === pickSeq.current) {
        setSampleErr(e instanceof Error ? e.message : 'Could not load the sample.')
        setSampleBusy(null)
      }
      return
    }
    if (seq !== pickSeq.current) return
    setSampleBusy(null)
    if (busyRef.current) return
    if (camRef.current) camRef.current.value = ''
    if (galRef.current) galRef.current.value = ''
    if (file) {
      if (!onFile(file, s.credit)) return
    } else {
      clearPhoto()
    }
    setDescription(s.description ?? '')
    setPos([s.latitude, s.longitude])
    setLocSource('map')
    setRecenter((n) => n + 1)
    setTime(toLocalInput(new Date()))
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
        <AiModeBadge health={health} />
      </header>

      {samples && samples.length > 0 && (
        <div>
          <SampleRow samples={samples} busyId={sampleBusy} onPick={(s) => void pickSample(s)} />
          {sampleErr && <div className="hint hint-bad">{sampleErr}</div>}
        </div>
      )}

      {/* Photo */}
      <section className="field">
        <div className="field-label">
          <span className="step">1</span> Photo
        </div>
        {preview ? (
          <div>
            <div className="photo-preview">
              <img src={preview} alt="Selected" />
              <button type="button" className="btn btn-ghost btn-sm photo-x" onClick={clearPhoto}>
                Remove
              </button>
            </div>
            {photoCredit && (
              <div className="photo-credit muted small">
                <Linkified text={photoCredit} />
              </div>
            )}
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

      <p className="privacy-note">
        Please avoid faces, licence plates and names. Photos lose their GPS and device data on upload, are analysed by
        AI and are deleted automatically after a while. You can delete your report once it has been assessed.{' '}
        <Link to="/privacy">How we use your data</Link>
      </p>

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
