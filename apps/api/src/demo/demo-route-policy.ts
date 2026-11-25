/** Explicit method and path allowlists, with no prefix bypass. */
export function demoAuthRouteAllowed(method:string,path:string):boolean {
 const normalized=path.toLowerCase();
 return (normalized!=='/api/auth' && !normalized.startsWith('/api/auth/')) || (method==='GET' && normalized==='/api/auth/me');
}
export function demoPendingRouteAllowed(method:string,path:string):boolean {
 return (method==='GET'&&path==='/api/demo/me')||(method==='POST'&&(path==='/api/demo/commit'||path==='/api/demo/logout'));
}
