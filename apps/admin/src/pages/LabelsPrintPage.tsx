import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { QueryState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/utils';

interface Label {
  id: string;
  rollNo: string;
  qrCode: string;
  content: string;
  fabricCode: string;
  fabricName: string;
  lotNo: string | null;
  dyeLotNo: string | null;
  colorCode: string | null;
  nominalLengthM: number | null;
  svg: string;
}

/** 布卷二维码标签打印页（每张 70×40mm，浏览器打印） */
export function LabelsPrintPage() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const q = useQuery({
    queryKey: ['labels', ids.join(',')],
    queryFn: () => api.post<Label[]>('/rolls/labels', { ids }),
    enabled: ids.length > 0,
  });
  return (
    <div className="min-h-screen bg-white p-6">
      <style>{`@page { size: A4; margin: 8mm; } .label { width: 70mm; height: 40mm; break-inside: avoid; }`}</style>
      <div className="no-print mb-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">共 {q.data?.length ?? 0} 张标签 · 建议使用不干胶标签纸，打印时关闭"页眉页脚"</div>
        <Button onClick={() => window.print()} disabled={!q.data?.length}>
          <Printer /> 打印
        </Button>
      </div>
      <QueryState q={q} empty={!ids.length}>
        <div className="flex flex-wrap gap-[2mm]">
          {q.data?.map((l) => (
            <div key={l.id} className="label flex items-center gap-[2mm] border border-dashed border-gray-300 p-[2mm] text-black">
              <img
                alt={l.content}
                className="h-[34mm] w-[34mm] shrink-0"
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.svg)}`}
              />
              <div className="min-w-0 text-[9pt] leading-tight">
                <div className="text-[12pt] font-bold">{l.rollNo}</div>
                <div className="mt-[1mm] truncate">{l.fabricCode}</div>
                <div className="truncate">{l.fabricName}</div>
                <div className="mt-[1mm]">批号 {l.lotNo ?? '-'}</div>
                <div>缸号 {l.dyeLotNo ?? '-'} · 色号 {l.colorCode ?? '-'}</div>
                <div>标称 {fmtNum(l.nominalLengthM)} m</div>
                <div className="mt-[1mm] font-mono text-[7pt] text-gray-500">{l.qrCode}</div>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
    </div>
  );
}
