import type { Metadata } from 'next';
import './globals.css';
import './language-toggle.css';
export const metadata:Metadata={title:'IMS TARA MAA · Saree Inventory',description:'Every piece, accounted for. Saree inventory and artisan management.',icons:{icon:'/ims-tara-maa-app-icon.png',shortcut:'/ims-tara-maa-app-icon.png',apple:'/ims-tara-maa-app-icon.png'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
