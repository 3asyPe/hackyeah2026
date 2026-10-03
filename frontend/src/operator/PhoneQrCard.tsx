import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function PhoneQrCard() {
  const url = window.location.origin + '/'
  const host = window.location.hostname
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    QRCode.toDataURL(url, { width: 160, margin: 1 })
      .then((d) => { if (live) setQr(d) })
      .catch(() => { if (live) setQr(null) })
    return () => { live = false }
  }, [url])

  return (
    <section className="card">
      <header className="card-head">
        <h3>Report from your phone</h3>
      </header>
      <div className="qr-body">
        {qr && <img src={qr} width={160} height={160} alt="QR code for the reporting page" />}
        <div>
          <div className="mono small">{url}</div>
          {local && (
            <p className="muted small qr-hint">
              Phones cannot reach localhost. Open this page via the laptop's network address (for example https://192.168.x.x:5173, started with npm run dev:https) and the QR code will point there.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
