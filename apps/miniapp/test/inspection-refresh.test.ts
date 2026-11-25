import {expect,it} from 'vitest';
import {preserveLocalOnRefresh,refreshRemotePhotoUrls} from '../src/lib/inspection-refresh';

const clean={localRev:4,syncedRev:4,baseVersion:5,photos:[]};
it('refreshes server-authorized URLs by media ID while preserving dirty draft contents and photo order',()=>{
 const photo={mediaId:'a',status:'uploaded',localPath:null,thumbPath:null,remoteThumb:'https://192.0.2.1/expired'};
 const draft={localRev:5,syncedRev:4,remarks:'unsynced note',photos:[photo,{...photo,mediaId:'b'}]};
 refreshRemotePhotoUrls(draft.photos,[{mediaId:'b',url:'https://example.invalid/b'},{mediaId:'a',url:'https://example.invalid/a',thumbUrl:'https://example.invalid/a-thumb'}]);
 expect(draft).toEqual({localRev:5,syncedRev:4,remarks:'unsynced note',photos:[{...photo,remoteThumb:'https://example.invalid/a-thumb'},{...photo,mediaId:'b',remoteThumb:'https://example.invalid/b'}]});
});
it('does not replace local or pending photos, resurrect deleted photos, or rewrite unmatched URLs',()=>{
 const p={mediaId:'a',status:'uploaded',localPath:null,thumbPath:null,remoteThumb:'old'};
 const photos=[{...p,localPath:'/local'}, {...p,thumbPath:'/thumb'}, {...p,status:'uploading'}, {...p,mediaId:'absent'}];
 const before=JSON.parse(JSON.stringify(photos));
 refreshRemotePhotoUrls(photos,[{mediaId:'a',url:'new'},{mediaId:'deleted',url:'other'}]);
 expect(photos).toEqual(before);
});
it('does not replace a photo added while the page-show request is pending',()=>{
 const latest={...clean,localRev:5,photos:[{status:'uploading'}]};
 expect(preserveLocalOnRefresh(clean,latest,{status:'DRAFT',draftVersion:5})).toBe(true);
});
it('retains an edit already synced while an older read response was in flight',()=>{
 expect(preserveLocalOnRefresh(clean,{...clean,localRev:6,syncedRev:6,baseVersion:7},{status:'DRAFT',draftVersion:5})).toBe(true);
});
it('keeps unchanged pending photos and accepts current server state for clean or noneditable drafts',()=>{
 expect(preserveLocalOnRefresh(clean,{...clean,photos:[{status:'failed'}]},{status:'DRAFT',draftVersion:5})).toBe(true);
 expect(preserveLocalOnRefresh(clean,clean,{status:'DRAFT',draftVersion:5})).toBe(false);
 expect(preserveLocalOnRefresh(clean,{...clean,localRev:6},{status:'APPROVED',draftVersion:7})).toBe(false);
});
