/** Review instance is a small, read-only sales workflow. All other routes fail closed. */
export function reviewRouteAllowed(method:string,path:string):boolean {
 if(method==='POST')return ['/api/review-access/login','/api/demo/commit','/api/demo/logout'].includes(path);
 if(method!=='GET')return false;
 if(['/api/health','/api/demo/me','/api/auth/me','/api/orders'].includes(path))return true;
 return /^\/api\/orders\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/reports(?:\/[1-9][0-9]*\/pdf)?)?$/i.test(path);
}
