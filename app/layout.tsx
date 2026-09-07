import type { Metadata } from 'next';
import './globals.css';
import 'leaflet/dist/leaflet.css';
export const metadata: Metadata = {
  title: 'Крок — ваша щоденна прогулянка',
  description:
    'Малюйте пішохідні маршрути та плануйте прогулянку під свою ціль кроків.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Крок', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <head>
        <meta name="theme-color" content="#163c32" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
