/**
 * 匯入異動摘要 · NARCOS 品牌深色版（Yen 2026-07-04 UI overhaul）
 *
 * 對應 docs/spec.md §7 UI + 憲章防護 #6 + #9 + #10
 * UI 用 SchedulePage / BatchDetail 同一套視覺基準：
 *   #0F0F12 底 · #141417 卡 · #26262C line · acc(#F5D400) · Anton/Noto TC/Space Mono
 *   通道色：賣貨便 acc黃 · 面交 綠 · 宅配 青 · KOL 紫 · 待分類 紅
 *   邏輯不動（resolutions state / onDecide / onClose 保 API）
 */
import { useEffect, useState } from "react";
import type { ImportDiff, ImportResolution, ImportRun, Order } from "../domain/models";
import { addResolution } from "../db/import-runs";
import { resolveDisappearance } from "../db/orders";
import { db } from "../db/schema";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

const C = {
  bg: "#0F0F12",
  card: "#141417",
  cardAlt: "#161619",
  line: "#26262C",
  line2: "#1F1F24",
  ink: "#F5F4EF",
  mut: "#C9C9CF",
  mut2: "#8A8A93",
  mut3: "#6C6C74",
  acc: "var(--acc,#F5D400)",
  green: "#43B23C",
  cyan: "#2AC7E8",
  red: "#E5352B",
  redTint: "#2a1010",
  orange: "#E5622A",
  purple: "#8557C9",
} as const;

const CHANNEL_META: Record<string, { label: string; color: string }> = {
  賣貨便:    { label: "賣貨便", color: C.acc },
  面交_中壢: { label: "面交·中壢", color: C.green },
  面交_台中: { label: "面交·台中", color: C.green },
  面交_其他: { label: "面交·其他", color: C.green },
  宅配:      { label: "宅配", color: C.cyan },
  KOL:       { label: "KOL", color: C.purple },
  待分類:    { label: "待分類", color: C.red },
};

export function ImportSummaryModal({
  run,
  onClose,
}: {
  run: ImportRun;
  onClose: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, ImportResolution["resolution"]>>({});
  const [disappearedOrders, setDisappearedOrders] = useState<Order[]>([]);
  const [changedOrders, setChangedOrders] = useState<Order[]>([]);

  useEffect(() => {
    void (async () => {
      const dOrders = await db.orders.where("id").anyOf(run.diff.disappeared).toArray();
      const cOrders = await db.orders.where("id").anyOf(run.diff.fields_changed).toArray();
      setDisappearedOrders(dOrders);
      setChangedOrders(cOrders);
    })();
  }, [run.id]);

  const needsResolution = run.diff.disappeared.length + run.diff.fields_changed.length;
  const resolvedCount = Object.keys(resolutions).length;
  const canClose = resolvedCount >= needsResolution;

  async function decide(orderId: string, resolution: ImportResolution["resolution"]) {
    setResolutions((r) => ({ ...r, [orderId]: resolution }));
    const now = new Date().toISOString();
    await addResolution(run.id, { order_id: orderId, resolution, resolved_at: now });
    if (resolution === "shipped" || resolution === "canceled" || resolution === "kept_active") {
      await resolveDisappearance(orderId, resolution, now);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", overflowY: "auto" }}
    >
      <div
        style={{
          background: C.bg,
          border: `1px solid ${C.line}`,
          width: "100%",
          maxWidth: 1080,
          maxHeight: "94vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header · 品牌膠帶 + Anton title */}
        <div style={{ position: "sticky", top: 0, background: C.bg, zIndex: 2 }}>
          <div className="flex items-center justify-between flex-wrap" style={{ padding: "14px 20px 12px", gap: 12 }}>
            <div className="flex items-baseline flex-wrap" style={{ gap: 12 }}>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, letterSpacing: ".18em" }}>IMPORT · DIFF</span>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: C.ink }}>匯入異動摘要</span>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>· 憲章 #9/#10 逐筆拍板</span>
            </div>
            <button
              type="button"
              disabled={!canClose}
              onClick={onClose}
              title={canClose ? "全部處理完、送出" : `還有 ${needsResolution - resolvedCount} 筆待拍板`}
              style={{
                fontFamily: F.tc, fontWeight: 900, fontSize: 12,
                color: canClose ? "#111" : C.mut3,
                background: canClose ? C.green : "transparent",
                border: `1px solid ${canClose ? C.green : C.line}`,
                padding: "7px 14px",
                cursor: canClose ? "pointer" : "not-allowed",
                letterSpacing: ".05em",
              }}
            >
              {canClose ? "✓ 送出、更新系統" : `⏳ 剩 ${needsResolution - resolvedCount} 筆需處理`}
            </button>
          </div>
          {/* 警示膠帶 */}
          <div style={{ height: 7, background: "repeating-linear-gradient(45deg,var(--acc,#F5D400) 0 14px,#111 14px 28px)" }} />
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px 20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          <StatSection diff={run.diff} />

          {disappearedOrders.length > 0 && (
            <DisappearedSection
              orders={disappearedOrders}
              resolutions={resolutions}
              onDecide={decide}
            />
          )}

          {changedOrders.length > 0 && (
            <ChangedSection
              orders={changedOrders}
              resolutions={resolutions}
              onDecide={decide}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Stat cells · 深底 border-left 通道色 · Anton 大數字 ──
function StatSection({ diff }: { diff: ImportDiff }) {
  const cells = [
    { label: "新單",     n: diff.added.length,             color: C.cyan,   note: "＋" },
    { label: "剛付款",   n: diff.payment_confirmed.length, color: C.green,  note: "$" },
    { label: "資訊變動", n: diff.fields_changed.length,    color: C.acc,    note: "✎" },
    { label: "消失",     n: diff.disappeared.length,       color: C.red,    note: "?" },
    { label: "未動",     n: diff.unchanged.length,         color: C.mut3,   note: "·" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
      {cells.map((c) => (
        <div
          key={c.label}
          style={{
            background: C.card,
            border: `1px solid ${C.line}`,
            borderLeft: `3px solid ${c.color}`,
            padding: "10px 14px",
          }}
        >
          <div className="flex items-baseline justify-between" style={{ marginBottom: 2 }}>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, letterSpacing: ".14em" }}>
              <span style={{ color: c.color, marginRight: 5 }}>{c.note}</span>
              {c.label}
            </span>
          </div>
          <div style={{ fontFamily: F.anton, fontSize: 30, color: c.n > 0 ? C.ink : C.mut3, lineHeight: 1 }}>
            {c.n}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section header + bulk pending confirm 條 · 共用 ──
function SectionHeader({
  color,
  title,
  hint,
  unresolvedCount,
  bulkOptions,
  pendingBulk,
  pendingLabel,
  onBulk,
  onConfirm,
  onCancel,
  busy,
}: {
  color: string;
  title: string;
  hint: string;
  unresolvedCount: number;
  bulkOptions: { key: string; label: string; color: string; textColor?: string }[];
  pendingBulk: string | null;
  pendingLabel: string;
  onBulk: (key: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 8 }}>
        <div className="flex items-baseline" style={{ gap: 8 }}>
          <span style={{ fontFamily: F.mono, fontSize: 10, color, letterSpacing: ".14em" }}>▎</span>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color }}>{title}</span>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>· {hint}</span>
        </div>
        {unresolvedCount > 1 && !pendingBulk && (
          <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>批次剩 {unresolvedCount}：</span>
            {bulkOptions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onBulk(opt.key)}
                style={{
                  fontFamily: F.tc, fontWeight: 900, fontSize: 10,
                  color: opt.textColor ?? opt.color,
                  background: "transparent",
                  border: `1px solid ${opt.color}`,
                  padding: "3px 10px",
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {pendingBulk && (
        <div
          className="flex items-center flex-wrap"
          style={{
            gap: 10, padding: "8px 12px",
            background: "#241a06", border: `1px solid ${C.acc}`,
            marginBottom: 8,
          }}
        >
          <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: C.ink }}>
            ⚠ 將剩下 {unresolvedCount} 筆全部標為「<span style={{ color: C.acc }}>{pendingLabel}</span>」？
          </span>
          <div className="flex" style={{ gap: 6, marginLeft: "auto" }}>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              style={{
                fontFamily: F.tc, fontWeight: 900, fontSize: 11,
                color: "#111", background: C.acc, border: "none",
                padding: "5px 12px",
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "處理中…" : "確認"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              style={{
                fontFamily: F.mono, fontSize: 10, color: C.mut2,
                background: "transparent", border: `1px solid ${C.line}`,
                padding: "5px 12px",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section 1 · 消失待確認 ──
function DisappearedSection({
  orders,
  resolutions,
  onDecide,
}: {
  orders: Order[];
  resolutions: Record<string, ImportResolution["resolution"]>;
  onDecide: (id: string, r: ImportResolution["resolution"]) => void;
}) {
  const unresolved = orders.filter((o) => !resolutions[o.id]);
  const [pendingBulk, setPendingBulk] = useState<null | "shipped" | "canceled" | "kept_active">(null);
  const [busyBulk, setBusyBulk] = useState(false);

  const confirmBulk = async () => {
    if (!pendingBulk || busyBulk) return;
    setBusyBulk(true);
    try {
      for (const o of unresolved) await onDecide(o.id, pendingBulk);
    } finally {
      setBusyBulk(false);
      setPendingBulk(null);
    }
  };

  const pendingLabel =
    pendingBulk === "shipped" ? "已出貨" :
    pendingBulk === "canceled" ? "已取消" :
    pendingBulk === "kept_active" ? "暫留" : "";

  return (
    <section>
      <SectionHeader
        color={C.red}
        title={`消失待確認（${orders.length} 筆）`}
        hint="憲章 #9 必須逐一拍板"
        unresolvedCount={unresolved.length}
        bulkOptions={[
          { key: "shipped",     label: "全部已出貨", color: C.green },
          { key: "canceled",    label: "全部取消",   color: C.red },
          { key: "kept_active", label: "全部暫留",   color: C.mut2 },
        ]}
        pendingBulk={pendingBulk}
        pendingLabel={pendingLabel}
        onBulk={(k) => setPendingBulk(k as "shipped" | "canceled" | "kept_active")}
        onConfirm={() => void confirmBulk()}
        onCancel={() => setPendingBulk(null)}
        busy={busyBulk}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {orders.map((o) => (
          <DisappearedCard
            key={o.id}
            order={o}
            decision={resolutions[o.id]}
            onDecide={onDecide}
          />
        ))}
      </div>
    </section>
  );
}

function DisappearedCard({
  order: o,
  decision,
  onDecide,
}: {
  order: Order;
  decision: ImportResolution["resolution"] | undefined;
  onDecide: (id: string, r: ImportResolution["resolution"]) => void;
}) {
  const meta = CHANNEL_META[o.channel] ?? { label: o.channel, color: C.mut2 };
  const frozen = o.frozen_after_label_print;
  return (
    <div
      style={{
        background: decision ? C.cardAlt : C.card,
        border: `1px solid ${C.line2}`,
        borderLeft: `3px solid ${meta.color}`,
        padding: "10px 12px",
        opacity: decision ? 0.55 : 1,
      }}
    >
      <div className="flex items-start justify-between flex-wrap" style={{ gap: 10 }}>
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div className="flex items-baseline flex-wrap" style={{ gap: 10 }}>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 11, color: meta.color, letterSpacing: ".05em" }}>
              {meta.label}
            </span>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mut2 }}>{o.id}</span>
            <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: C.ink }}>{o.recipient.name ?? "—"}</span>
            {frozen && (
              <span style={{ fontFamily: F.mono, fontSize: 9, color: C.orange, border: `1px solid ${C.orange}`, padding: "1px 5px", letterSpacing: ".05em" }}>
                🖨 已印標籤
              </span>
            )}
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginTop: 4, letterSpacing: ".05em" }}>
            {o.batchDate ?? "—"} · ${o.revenue.grossTotal}
            {o.rawSource.file && <> · 來源 {o.rawSource.file}</>}
          </div>
        </div>
        <ActionCluster
          decision={decision}
          decisionLabels={{
            shipped:     "✓ 已出貨",
            canceled:    "✗ 已取消",
            kept_active: "⏸ 暫留",
          }}
          actions={[
            { key: "shipped",     label: "1 已出貨", tone: "primary" },
            { key: "canceled",    label: "2 已取消", tone: "danger"  },
            { key: "kept_active", label: "3 暫留",   tone: "neutral" },
          ]}
          onPick={(k) => onDecide(o.id, k as ImportResolution["resolution"])}
        />
      </div>
      {frozen && !decision && (
        <div
          style={{
            marginTop: 8, padding: "6px 10px",
            background: "#2a1a06", border: `1px solid ${C.orange}`,
            fontFamily: F.mono, fontSize: 10, color: C.orange,
          }}
        >
          ⚠ 這筆標籤已印。取消時需重印同批其他單、或整批重印。
        </div>
      )}
    </div>
  );
}

// ── Section 2 · 資訊變動待確認 ──
function ChangedSection({
  orders,
  resolutions,
  onDecide,
}: {
  orders: Order[];
  resolutions: Record<string, ImportResolution["resolution"]>;
  onDecide: (id: string, r: ImportResolution["resolution"]) => void;
}) {
  const unresolved = orders.filter((o) => !resolutions[o.id]);
  const [pendingBulk, setPendingBulk] = useState<null | "accept_change" | "reject_change">(null);
  const [busyBulk, setBusyBulk] = useState(false);

  const confirmBulk = async () => {
    if (!pendingBulk || busyBulk) return;
    setBusyBulk(true);
    try {
      for (const o of unresolved) await onDecide(o.id, pendingBulk);
    } finally {
      setBusyBulk(false);
      setPendingBulk(null);
    }
  };

  const pendingLabel =
    pendingBulk === "accept_change" ? "接受變動" :
    pendingBulk === "reject_change" ? "保留舊資料" : "";

  return (
    <section>
      <SectionHeader
        color={C.acc}
        title={`資訊變動待確認（${orders.length} 筆）`}
        hint="憲章 #10 不 auto-overwrite"
        unresolvedCount={unresolved.length}
        bulkOptions={[
          { key: "accept_change", label: "全部接受",   color: C.green },
          { key: "reject_change", label: "全部保留舊", color: C.mut2 },
        ]}
        pendingBulk={pendingBulk}
        pendingLabel={pendingLabel}
        onBulk={(k) => setPendingBulk(k as "accept_change" | "reject_change")}
        onConfirm={() => void confirmBulk()}
        onCancel={() => setPendingBulk(null)}
        busy={busyBulk}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {orders.map((o) => (
          <ChangedCard
            key={o.id}
            order={o}
            decision={resolutions[o.id]}
            onDecide={onDecide}
          />
        ))}
      </div>
    </section>
  );
}

function ChangedCard({
  order: o,
  decision,
  onDecide,
}: {
  order: Order;
  decision: ImportResolution["resolution"] | undefined;
  onDecide: (id: string, r: ImportResolution["resolution"]) => void;
}) {
  const lastChange = o.changes[o.changes.length - 1];
  if (!lastChange) return null;
  const meta = CHANNEL_META[o.channel] ?? { label: o.channel, color: C.mut2 };

  return (
    <div
      style={{
        background: decision ? C.cardAlt : C.card,
        border: `1px solid ${C.line2}`,
        borderLeft: `3px solid ${meta.color}`,
        padding: "10px 12px",
        opacity: decision ? 0.55 : 1,
      }}
    >
      <div className="flex items-start justify-between flex-wrap" style={{ gap: 10, marginBottom: 8 }}>
        <div className="flex items-baseline flex-wrap" style={{ gap: 10 }}>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 11, color: meta.color, letterSpacing: ".05em" }}>
            {meta.label}
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mut2 }}>{o.id}</span>
          <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: C.ink }}>{o.recipient.name ?? "—"}</span>
        </div>
        <ActionCluster
          decision={decision}
          decisionLabels={{
            accept_change: "✓ 接受",
            reject_change: "✗ 保留舊",
            reprint:       "🖨 重印",
          }}
          actions={[
            { key: "accept_change", label: "1 接受變動", tone: "primary" },
            { key: "reject_change", label: "2 保留舊",   tone: "neutral" },
            ...(o.frozen_after_label_print
              ? [{ key: "reprint", label: "3 接受+重印", tone: "warn" as const }]
              : []),
          ]}
          onPick={(k) => onDecide(o.id, k as ImportResolution["resolution"])}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <DiffPane title="舊值" color={C.red} rows={Object.entries(lastChange.fields).map(([k, v]) => [k, String(v.from)])} />
        <DiffPane title="新值" color={C.green} rows={Object.entries(lastChange.fields).map(([k, v]) => [k, String(v.to)])} />
      </div>
    </div>
  );
}

function DiffPane({ title, color, rows }: { title: string; color: string; rows: [string, string][] }) {
  return (
    <div style={{ background: C.cardAlt, border: `1px solid ${C.line2}`, borderLeft: `3px solid ${color}`, padding: "6px 10px" }}>
      <div style={{ fontFamily: F.mono, fontSize: 9, color, letterSpacing: ".14em", marginBottom: 4 }}>{title}</div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ fontFamily: F.mono, fontSize: 10, color: C.mut, lineHeight: 1.5 }}>
          <span style={{ color: C.mut3 }}>{k}:</span> <span style={{ color: C.ink }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── 按鈕 cluster ──
type ActionTone = "primary" | "danger" | "neutral" | "warn";
function ActionCluster({
  decision,
  decisionLabels,
  actions,
  onPick,
}: {
  decision: string | undefined;
  decisionLabels: Record<string, string>;
  actions: { key: string; label: string; tone: ActionTone }[];
  onPick: (key: string) => void;
}) {
  if (decision) {
    return (
      <span
        style={{
          fontFamily: F.tc, fontWeight: 900, fontSize: 10, color: C.green,
          border: `1px solid ${C.green}`, padding: "4px 10px", letterSpacing: ".05em",
        }}
      >
        {decisionLabels[decision] ?? decision}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap" style={{ gap: 5 }}>
      {actions.map((a) => (
        <ActionButton key={a.key} label={a.label} tone={a.tone} onClick={() => onPick(a.key)} />
      ))}
    </div>
  );
}

function ActionButton({ label, tone, onClick }: { label: string; tone: ActionTone; onClick: () => void }) {
  const styles: Record<ActionTone, { color: string; background: string; border: string }> = {
    primary: { color: "#111",   background: C.acc,        border: `1px solid ${C.acc}` },
    danger:  { color: C.red,    background: "transparent", border: `1px solid ${C.red}` },
    neutral: { color: C.mut2,   background: "transparent", border: `1px solid ${C.line}` },
    warn:    { color: C.orange, background: "transparent", border: `1px solid ${C.orange}` },
  };
  const s = styles[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: F.tc, fontWeight: 900, fontSize: 10,
        color: s.color, background: s.background, border: s.border,
        padding: "5px 11px", cursor: "pointer", letterSpacing: ".05em",
      }}
    >
      {label}
    </button>
  );
}
