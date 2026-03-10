import dynamic from 'next/dynamic'

const Dashboard = dynamic(() => import('./Dashboard'), { ssr: false })

export default function Page() {
  return <Dashboard />
}
