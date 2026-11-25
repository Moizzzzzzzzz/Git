import { makeDemoPng } from './synthetic-media';
describe('synthetic demo images',()=>{
  it('creates deterministic labelled PNGs without external files',()=>{
    const a=makeDemoPng('label'), b=makeDemoPng('fabric');
    expect(a.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(a.readUInt32BE(16)).toBe(320);expect(a.readUInt32BE(20)).toBe(180);
    expect(a.includes(Buffer.from('DEMO'))).toBe(true);
    expect(makeDemoPng('label').equals(a)).toBe(true);
    expect(b.equals(a)).toBe(false);
  });
});

it('has a distinct synthetic JPEG thumbnail for the demo upload flow',()=>{
  const {makeDemoJpegThumbnail}=require('./synthetic-media');
  const b:Buffer=makeDemoJpegThumbnail();
  expect(b.subarray(0,2).toString('hex')).toBe('ffd8');
  expect(b.subarray(-2).toString('hex')).toBe('ffd9');
});

it('rejects a production bucket before uploading any synthetic object',async()=>{
  const {createSyntheticMediaUploader}=require('./synthetic-media');
  const media={createUploadIntent:jest.fn().mockResolvedValue({mediaId:'m'})};
  const prisma={mediaAsset:{findUnique:jest.fn().mockResolvedValue({bucket:'production',objectKey:'inspections/x',thumbKey:'inspections/y'})}};
  const put=jest.fn();const upload=createSyntheticMediaUploader({media,prisma,put});
  await expect(upload('inspection','label',{userId:'i'})).rejects.toThrow('隔离');
  expect(put).not.toHaveBeenCalled();
});
