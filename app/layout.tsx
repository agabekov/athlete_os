import type { Metadata } from 'next'
import { Chakra_Petch, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const display = Chakra_Petch({ weight: ['500', '600', '700'], subsets: ['latin'], variable: '--font-disp' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jbm' })

export const metadata: Metadata = {
  title: 'Athlete OS',
  description: 'Personal WHOOP dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="relative min-h-screen text-ink antialiased">
        <div className="grain" aria-hidden />
        {children}
      </body>
    </html>
  )
}
