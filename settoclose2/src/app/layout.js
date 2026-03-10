export const metadata = {
  title: 'SetToClose Dashboard',
  description: 'AquaFeel Lead Gen Dashboard',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#080a0d' }}>
        {children}
      </body>
    </html>
  )
}
