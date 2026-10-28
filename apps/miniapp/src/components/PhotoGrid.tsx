import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { photoSrc, removePhoto, uploadPending } from '@/lib/photos';
import type { LocalPhoto } from '@/lib/draft';
import './PhotoGrid.scss';

const STATUS: Record<LocalPhoto['status'], string> = { pending: '待上传', uploading: '上传中', uploaded: '', failed: '失败·点击重试' };

export function PhotoGrid({ inspectionId, photos, editable }: { inspectionId: string; photos: LocalPhoto[]; editable: boolean }) {
  function tap(p: LocalPhoto) {
    if (p.status === 'failed') {
      void uploadPending(inspectionId);
      return;
    }
    const src = photoSrc(p);
    const items = editable ? ['查看大图', '删除'] : ['查看大图'];
    void Taro.showActionSheet({ itemList: items }).then((r) => {
      if (r.tapIndex === 0) void Taro.previewImage({ urls: [p.localPath ?? src], current: p.localPath ?? src });
      if (r.tapIndex === 1) {
        void Taro.showModal({ title: '删除照片？', content: '删除后需要重新拍摄' }).then((m) => m.confirm && removePhoto(inspectionId, p.localId));
      }
    }).catch(() => undefined);
  }
  return (
    <View className="thumbs">
      {photos.map((p) => (
        <View key={p.localId} className="photo" onClick={() => tap(p)}>
          <Image className="thumb" src={photoSrc(p)} mode="aspectFill" />
          {p.status !== 'uploaded' && <Text className={`photo-status ${p.status}`}>{STATUS[p.status]}</Text>}
        </View>
      ))}
    </View>
  );
}
