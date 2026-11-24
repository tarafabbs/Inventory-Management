import type { Metadata } from 'next';
import {cookies} from 'next/headers';
import InventoryLanguageProvider from './inventory-language';
import './globals.css';
import './language-toggle.css';
export const metadata:Metadata={title:'IMS TARA MAA · Saree Inventory',description:'Every piece, accounted for. Saree inventory and artisan management.',icons:{icon:'/ims-tara-maa-app-icon.png',shortcut:'/ims-tara-maa-app-icon.png',apple:'/ims-tara-maa-app-icon.png'}};
export default async function RootLayout({children}:Readonly<{children:React.ReactNode}>){const language=(await cookies()).get('ims-language')?.value==='bn'?'bn':'en';return <html lang={language}><body data-language={language}><InventoryLanguageProvider initialLanguage={language}>{children}</InventoryLanguageProvider></body></html>}
