import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useState } from 'react';
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
  const [paper, setPaper] = useState<'roll' | 'a4'>('roll');
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const q = useQuery({
    queryKey: ['labels', ids.join(',')],
    queryFn: () => api.post<Label[]>('/rolls/labels', { ids }),
    enabled: ids.length > 0,
  });
  return (
    <div className="print-sheet min-h-screen bg-white p-6 text-black">
      <style>{`@page { size: ${paper === 'roll' ? '70mm 40mm' : 'A4'}; margin: ${paper === 'roll' ? '0' : '8mm'}; } .label { width: 70mm; height: 40mm; box-sizing: border-box; break-inside: avoid; } @media print { .print-sheet { padding: 0 !important; } ${paper === 'roll' ? '.label { break-after: page; border: 0 !important; } .label:last-child { break-after: auto; } .label-list { display: block !important; }' : ''} }`}</style>
      <div className="no-print mb-4 flex items-center justify-between">
        <div className="text-sm text-gray-600">共 {q.data?.length ?? 0} 张标签 · 测试尺寸 70 × 40 mm · 打印时关闭页眉页脚并选择实际尺寸</div><label className="text-sm">纸张格式 <select className="bg-white text-black" value={paper} onChange={(e) => setPaper(e.target.value as 'roll' | 'a4')}><option value="roll">卷筒标签 70 × 40 mm</option><option value="a4">A4 不干胶</option></select></label>
        <Button className="bg-neutral-800 text-white hover:bg-neutral-700" onClick={() => window.print()} disabled={!q.data?.length}>
          <Printer /> 打印
        </Button>
      </div>
      <QueryState q={q} empty={!ids.length}>
        <div className="label-list flex flex-wrap gap-[2mm]">
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
