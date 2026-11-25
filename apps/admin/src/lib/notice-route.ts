/** Translate only known small-program business destinations to local web routes. */
export function noticeRoute(pagePath:string|null){
 if(!pagePath||!/^\/?pages\//.test(pagePath))return null;
 const [page,query='']=pagePath.replace(/^\//,'').split('?');
 const id=new URLSearchParams(query).get('id');
 if(!id||!/^[a-zA-Z0-9-]+$/.test(id))return null;
 const routes:Record<string,string>={'pages/orders/detail':'/orders/','pages/task/index':'/tasks/','pages/business/index':'/business-tasks/','pages/review/detail':'/inspections/'};
 return routes[page]?`${routes[page]}${encodeURIComponent(id)}`:null;
}
