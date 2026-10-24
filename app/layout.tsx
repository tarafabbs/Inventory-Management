import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'IMS TARA MAA · Saree Inventory',description:'Every piece, accounted for. Saree inventory and artisan management.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
