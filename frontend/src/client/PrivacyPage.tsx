import { Link } from 'react-router-dom'
import { getPrivacy } from '../api'
import { usePoll } from '../hooks'

// Who answers privacy requests. Fill in before running this outside a demo.
const CONTROLLER = 'The team running this Incident Reporter prototype (HackYeah 2026)'

const days = (n: number | undefined, fallback: number) => `${n ?? fallback} days`

export default function PrivacyPage() {
  const { data: info } = usePoll(getPrivacy, null)
  const mode = info?.assessor_mode
  const aiOff = mode === 'replay' || mode === 'mock'
  return (
    <div className="page privacy">
      <header className="page-head">
        <div className="eyebrow">Privacy notice</div>
        <h1>Your data</h1>
        <p className="lede">What happens to a report you send, in plain words.</p>
      </header>

      <section className="card">
        <h3>What we collect</h3>
        <ul>
          <li>The photo, description, place and time you enter. No name, email or account.</li>
          <li>
            Photos are stored <strong>without</strong> their hidden metadata: GPS position, phone model and capture
            time are removed when the photo arrives.
          </li>
          <li>Like any website, the server sees your IP address and may record it in its logs.</li>
          <li>
            This device keeps a copy of your report and a secret receipt token so you can follow and delete it. The
            token is only sent to authorise those requests. Deleting the report removes the copy too.
          </li>
        </ul>
      </section>

      <section className="card">
        <h3>Why and who sees it</h3>
        <ul>
          <li>
            To assess the incident, group it with nearby reports and alert an operator when it looks urgent. Legal
            basis: public interest in handling local hazards (Art. 6(1)(e) GDPR) when run for a city or emergency
            service, otherwise our legitimate interest (Art. 6(1)(f)).
          </li>
          <li>
            The photo, description, exact location and time are analysed by an AI model from <strong>OpenAI</strong>{' '}
            (USA), acting as our processor. By default OpenAI does not use API data to train its models.
            {aiOff && ' In this demo instance no AI provider is called: assessments are replayed or simulated.'}
            {mode === 'replay_first' &&
              ' In this demo instance the bundled sample reports are answered from recorded results; any other report is sent to OpenAI as described.'}
          </li>
          <li>Operators see the full report, including the photo, to review and decide on it.</li>
          <li>
            The public map shows only the incident's location (the position of its first report), category, severity,
            time and number of reports. Never your photo or your description.
          </li>
        </ul>
      </section>

      <section className="card">
        <h3>How long we keep it</h3>
        <ul>
          <li>Reports are deleted automatically {days(info?.retention_days, 30)} after their last update.</li>
          <li>Rejected reports are deleted after {days(info?.rejected_retention_days, 7)}.</li>
        </ul>
      </section>

      <section className="card">
        <h3>Your rights</h3>
        <ul>
          <li>
            <strong>See and delete:</strong> open a report under <Link to="/my">My reports</Link> to see the details
            you sent and the report's status, and tap <em>Delete report</em> to erase it, including the photo, at any
            time once it has been assessed.
          </li>
          <li>
            You can also ask for access, correction, restriction or erasure, object to the processing, or complain to
            the data protection authority (in Poland: UODO, uodo.gov.pl).
          </li>
          <li>Controller: {CONTROLLER}.</li>
        </ul>
      </section>
    </div>
  )
}
