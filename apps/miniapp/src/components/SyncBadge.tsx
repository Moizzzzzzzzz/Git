import { Text } from '@tarojs/components';
import { syncLabel, type LocalDraft } from '@/lib/draft';

export function SyncBadge({ d }: { d: LocalDraft }) {
  const s = syncLabel(d);
  return <Text className={`tag ${s.tone}`}>{s.text}</Text>;
}
