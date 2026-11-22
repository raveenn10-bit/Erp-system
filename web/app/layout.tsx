import './styles.css';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'Sanjeewa Distribution ERP | Nugathalawa Ceylon Tea Export',description:'Distribution operations for Nugathalawa Ceylon Tea Export (Pvt) Ltd',manifest:'/manifest.webmanifest'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
