import { Navigate, Route, Routes } from 'react-router-dom'
import ClientLayout from './client/ClientLayout'
import SubmitPage from './client/SubmitPage'
import StatusPage from './client/StatusPage'
import MapPage from './client/MapPage'
import MyReportsPage from './client/MyReportsPage'
import OperatorLayout from './operator/OperatorLayout'
import OverviewPage from './operator/OverviewPage'
import QueuePage from './operator/QueuePage'
import ReportDetailPage from './operator/ReportDetailPage'
import IncidentDetailPage from './operator/IncidentDetailPage'

export default function App() {
  return (
    <Routes>
      <Route element={<ClientLayout />}>
        <Route index element={<SubmitPage />} />
        <Route path="r/:id" element={<StatusPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="my" element={<MyReportsPage />} />
      </Route>
      <Route path="operator" element={<OperatorLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="critical" element={<QueuePage status="critical" />} />
        <Route path="review" element={<QueuePage status="in_review" />} />
        <Route path="failures" element={<QueuePage status="failed" />} />
        <Route path="reports/:id" element={<ReportDetailPage />} />
        <Route path="incidents/:id" element={<IncidentDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
