import { deflateSync } from 'node:zlib';

const GLYPHS: Record<string, readonly string[]> = {
  D:['1110','1001','1001','1001','1110'], E:['1111','1000','1110','1000','1111'],
  M:['10001','11011','10101','10001','10001'], O:['0110','1001','1001','1001','0110'],
};
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const name=Buffer.from(type,'ascii'), len=Buffer.alloc(4), sum=Buffer.alloc(4);
  len.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([len,name,data,sum]);
}
/** Self-contained synthetic image. Contains no external inputs or real images. */
export function makeDemoPng(kind: 'label'|'fabric'): Buffer {
  const width=320,height=180,stride=width*4+1,raw=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=y*stride+1+x*4, stripe=kind==='fabric' && (x%16<2 || y%16<2);
    raw[i]=stripe?207:243;raw[i+1]=stripe?194:235;raw[i+2]=stripe?176:220;raw[i+3]=255;
  }
  const scale=8;let x0=76;
  for(const char of 'DEMO') {
    const glyph=GLYPHS[char];
    glyph.forEach((row,gy)=>[...row].forEach((pixel,gx)=>{
      if(pixel!=='1') return;
      for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++){
        const i=(70+gy*scale+yy)*stride+1+(x0+gx*scale+xx)*4;
        raw[i]=92;raw[i+1]=61;raw[i+2]=43;raw[i+3]=255;
      }
    }));
    x0+=(glyph[0].length+1)*scale;
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('tEXt',Buffer.from('Description\0DEMO synthetic image','ascii')),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

/** JPEG generated locally from the synthetic DEMO PNG; no customer image. */
export function makeDemoJpegThumbnail(): Buffer { return Buffer.from('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', 'base64'); }

import type { Actor } from '../../common/actor';
import type { MediaService } from '../../media/media.service';
import type { PrismaService } from '../../prisma/prisma.service';

export interface SyntheticMediaContext {
  media: Pick<MediaService,'createUploadIntent'|'confirm'>;
  prisma: Pick<PrismaService,'mediaAsset'>;
  /** Bound to an independently attested demo-only S3 client and bucket. */
  put(key:string,body:Buffer,contentType:string):Promise<void>;
}
export function createSyntheticMediaUploader(ctx:SyntheticMediaContext) {
  return async (inspectionId:string, kind:'label'|'fabric', actor:Actor):Promise<string> => {
    const image=makeDemoPng(kind),thumb=makeDemoJpegThumbnail();
    const intent=await ctx.media.createUploadIntent(actor,{inspectionId,mimeType:'image/png',sizeBytes:image.length,withThumbnail:true});
    const row=await ctx.prisma.mediaAsset.findUnique({where:{id:intent.mediaId}});
    if(!row||row.bucket!=='demo-media'||row.inspectionId!==inspectionId||row.uploadedById!==actor.userId||!row.thumbKey||!row.objectKey.startsWith('inspections/')||!row.thumbKey.startsWith('inspections/'))throw new Error('演示图片对象隔离校验失败');
    await ctx.put(row.objectKey,image,'image/png');await ctx.put(row.thumbKey,thumb,'image/jpeg');
    const confirmed=await ctx.media.confirm(actor,intent.mediaId);
    if(confirmed.status!=='UPLOADED')throw new Error('演示图片确认失败');
    return intent.mediaId;
  };
}
