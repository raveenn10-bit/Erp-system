import './styles.css';
import type {Metadata,Viewport} from 'next';
import {NativeShell} from '@/components/native-shell';
export const metadata:Metadata={title:'Sanjeewa Distribution ERP | Nugathalawa Ceylon Tea Export',description:'Distribution operations for Nugathalawa Ceylon Tea Export (Pvt) Ltd',manifest:'/manifest.webmanifest',icons:{icon:'/favicon.ico',apple:'/apple-touch-icon.png'},robots:{index:false,follow:false}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#0C5051'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><NativeShell/>{children}</body></html>}
