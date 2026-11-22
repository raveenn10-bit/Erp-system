import './styles.css';
import type {Metadata,Viewport} from 'next';
export const metadata:Metadata={title:'Sanjeewa Distribution ERP | Nugathalawa Ceylon Tea Export',description:'Distribution operations for Nugathalawa Ceylon Tea Export (Pvt) Ltd',manifest:'/manifest.webmanifest'};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#0C5051'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
