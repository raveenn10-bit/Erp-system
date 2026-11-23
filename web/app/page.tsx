'use client';
// Single entry point. In the Android app Capacitor serves this index.html for
// every route (e.g. after a cold start on /dashboard), so the root must render
// the right screen itself instead of redirecting (a redirect would loop).
import {useEffect,useState} from 'react';
import Dashboard from './dashboard/page';
import Login from './login/page';

export default function Home(){
  const [path,setPath]=useState<string|null>(null);
  useEffect(()=>setPath(window.location.pathname),[]);
  if(path===null)return <div className="boot-screen" aria-busy="true"><div className="loader"/></div>;
  return path.startsWith('/login')?<Login/>:<Dashboard/>;
}
