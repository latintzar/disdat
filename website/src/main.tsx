import React from 'react'
import ReactDOM from 'react-dom/client'
import DisDat from './DisDat'
import { Download, Privacy, Terms, Cookies, DataControls, Account, AuthCallback, GetStarted } from './Pages'
import './index.css'

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const routes: Record<string, React.ReactNode> = {
  '/download': <Download />,
  '/privacy': <Privacy />,
  '/terms': <Terms />,
  '/cookies': <Cookies />,
  '/data-controls': <DataControls />,
  '/account': <Account />,
  '/auth/callback': <AuthCallback />,
  '/get-started': <GetStarted />,
}
const view = routes[path] ?? <DisDat />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{view}</React.StrictMode>,
)
