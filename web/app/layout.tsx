import './styles.css';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'Sanjeewa Distribution ERP',description:'Distribution operations for Sanjeewa Distribution',manifest:'/manifest.webmanifest'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
