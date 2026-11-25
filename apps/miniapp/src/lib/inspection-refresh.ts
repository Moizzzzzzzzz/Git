type DraftRevision={localRev:number;syncedRev:number;baseVersion:number;photos:readonly {status:string}[]};

/** Refresh expiring authorized URLs without replacing edits or local photo files. */
export function refreshRemotePhotoUrls(
 photos: {mediaId:string|null;status:string;localPath:string|null;thumbPath:string|null;remoteThumb:string|null}[],
 serverPhotos: readonly {mediaId:string;thumbUrl?:string|null;url:string}[],
):void{
 const urls=new Map(serverPhotos.map(p=>[p.mediaId,p.thumbUrl??p.url]));
 for(const photo of photos){
  if(photo.status!=='uploaded'||!photo.mediaId||photo.localPath||photo.thumbPath)continue;
  const url=urls.get(photo.mediaId);
  if(url)photo.remoteThumb=url;
 }
}

/** Native photo selection can resume the page before its new local photo is saved. */
export function preserveLocalOnRefresh(before:DraftRevision|null,latest:DraftRevision|null,server:{status:string;draftVersion:number}):boolean{
 if(!latest||!['DRAFT','RETURNED'].includes(server.status))return false;
 return latest.localRev!==latest.syncedRev
  ||latest.photos.some(p=>p.status!=='uploaded')
  ||latest.localRev!==before?.localRev
  ||latest.baseVersion>server.draftVersion;
}
