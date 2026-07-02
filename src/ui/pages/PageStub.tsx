import { PageHeader } from "../brand/PageHeader";

/**
 * 頁面尚未實作時的占位。P2/P3/P4/P5 subagent 會整檔覆蓋。
 */
export function PageStub({
  caption,
  title,
  phase,
  note,
}: {
  caption: string;
  title: string;
  phase: string;
  note?: string;
}) {
  return (
    <>
      <PageHeader caption={caption} title={title} />
      <div className="px-6 py-10">
        <div className="bg-narcos-panel border border-narcos-line p-8">
          <div className="font-mono text-[12px] text-narcos-mut2 tracking-wideMono">
            {phase} · 待實作
          </div>
          <div className="font-notoTc font-black text-[20px] text-narcos-ink mt-2">
            此頁在 {phase} 落地
          </div>
          {note && (
            <div className="font-notoTc text-[13px] text-narcos-mut mt-3 leading-relaxed">
              {note}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
