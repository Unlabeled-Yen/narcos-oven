/**
 * MenuEditorPage — 菜單編輯頁（NARCOS.sugar 深色倉儲控制台風）
 *
 * ● 左欄：SKU 清單（props.menu.products record，分類 combo/single + 搜尋含 aliases）
 * ● 右欄：display_name / price / category / contains / match_signature / aliases / seen_count / notes
 * ● 頂部：Claude Code 建議新 SKU diff 區（靜態 demo，0 LLM，憲章 #2）
 * ● 編輯只改 local state（in-memory）。
 * ● 匯出走 MCP write_menu_yaml 或下載；瀏覽器無法直接寫 menu.yaml（底部提示）。
 *
 * 憲章 #1：match_signature include/exclude = menuLookup 關鍵字，禁 hardcode。
 * 憲章 #2：web app 0 LLM，建議區為靜態呈現。
 */

import { useState, useMemo, useCallback } from "react";
import { PageHeader } from "../brand/PageHeader";
import type { PageProps } from "./types";
import type { Product } from "../../domain/models";
import {
  C, F,
  STATIC_SUGGESTION,
  type EditState,
  productToEdit, emptyEdit, atomUnit,
} from "./MenuEditorPage.helpers";

// ── 小元件 ───────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, letterSpacing: ".12em", marginBottom: 6 }}>
      {children}
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────
export function MenuEditorPage({ menu }: PageProps) {
  const [localProducts, setLocalProducts] = useState<Record<string, Product>>(
    () => ({ ...menu.products })
  );
  const skuIds = useMemo(() => Object.keys(localProducts), [localProducts]);

  const [catFilter, setCatFilter] = useState<"all" | "combo" | "single">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(() => skuIds[0] ?? "");
  const [edit, setEdit] = useState<EditState>(() => {
    const p = localProducts[skuIds[0] ?? ""];
    return p ? productToEdit(p) : emptyEdit();
  });
  const [saved, setSaved] = useState(false);
  const [showSuggest, setShowSuggest] = useState(true);
  const [aliasInput, setAliasInput] = useState("");
  const [incInput, setIncInput] = useState("");
  const [excInput, setExcInput] = useState("");

  const filteredIds = useMemo(() => {
    const q = query.trim();
    return skuIds.filter((id) => {
      const p = localProducts[id]!;
      if (catFilter !== "all" && p.category !== catFilter) return false;
      if (!q) return true;
      return p.display_name.includes(q) || id.includes(q) || p.aliases.some((a) => a.includes(q));
    });
  }, [skuIds, localProducts, catFilter, query]);

  const handleSelect = useCallback((id: string) => {
    const p = localProducts[id];
    if (!p) return;
    setSelectedId(id); setEdit(productToEdit(p)); setSaved(false);
    setAliasInput(""); setIncInput(""); setExcInput("");
  }, [localProducts]);

  const handleSave = useCallback(() => {
    setLocalProducts((prev) => {
      const old = prev[selectedId];
      if (!old) return prev;
      const updated: Product = {
        ...old,
        display_name: edit.display_name,
        price: edit.price !== "" ? Number(edit.price) : null,
        category: edit.category,
        contains: edit.contains,
        match_signature: edit.match_signature,
        aliases: edit.aliases,
        notes: edit.notes || undefined,
      };
      return { ...prev, [selectedId]: updated };
    });
    setSaved(true);
  }, [selectedId, edit]);

  const handleAccept = useCallback(() => {
    const sg = STATIC_SUGGESTION;
    const newProd: Product = {
      display_name: sg.display_name, category: sg.category, price: sg.price, cost: sg.cost,
      contains: sg.contains, aliases: sg.aliases, match_signature: sg.match_signature,
      seen_count: sg.seen_count, notes: sg.notes,
    };
    setLocalProducts((prev) => ({ ...prev, [sg.id]: newProd }));
    setShowSuggest(false); setSelectedId(sg.id); setEdit(productToEdit(newProd)); setSaved(false);
  }, []);

  const changeCount = (idx: number, d: number) => {
    setEdit((e) => ({ ...e, contains: e.contains.map((c, i) => i === idx ? { ...c, count: Math.max(1, c.count + d) } : c) }));
    setSaved(false);
  };
  const removeInc = (w: string) => { setEdit((e) => ({ ...e, match_signature: { ...e.match_signature, include: e.match_signature.include.filter((x) => x !== w) } })); setSaved(false); };
  const addInc = () => { const v = incInput.trim(); if (!v || edit.match_signature.include.includes(v)) { setIncInput(""); return; } setEdit((e) => ({ ...e, match_signature: { ...e.match_signature, include: [...e.match_signature.include, v] } })); setIncInput(""); setSaved(false); };
  const removeExc = (w: string) => { setEdit((e) => ({ ...e, match_signature: { ...e.match_signature, exclude: e.match_signature.exclude.filter((x) => x !== w) } })); setSaved(false); };
  const addExc = () => { const v = excInput.trim(); if (!v || edit.match_signature.exclude.includes(v)) { setExcInput(""); return; } setEdit((e) => ({ ...e, match_signature: { ...e.match_signature, exclude: [...e.match_signature.exclude, v] } })); setExcInput(""); setSaved(false); };
  const removeAlias = (al: string) => { setEdit((e) => ({ ...e, aliases: e.aliases.filter((x) => x !== al) })); setSaved(false); };
  const addAlias = () => { const v = aliasInput.trim(); if (!v || edit.aliases.includes(v)) { setAliasInput(""); return; } setEdit((e) => ({ ...e, aliases: [...e.aliases, v] })); setAliasInput(""); setSaved(false); };

  const selProd = localProducts[selectedId];
  const totalSku = skuIds.length;

  // ── shared inline style helpers ─────────────────────────────
  const inp = (extra?: React.CSSProperties): React.CSSProperties => ({
    fontFamily: F.mono, fontSize: 12, color: "#E7E7EA", background: C.card,
    border: `1px solid ${C.border}`, outline: "none", borderRadius: 0, ...extra,
  });
  const tagBtn = (col: string, bg: string, bdr: string): React.CSSProperties => ({
    fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: col, background: bg,
    border: `1px solid ${bdr}`, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 6,
  });

  return (
    <div style={{ fontFamily: F.tc, minHeight: "100vh", background: C.bg }}>
      <PageHeader
        caption={`MENU · 主軌唯一真相 · source of truth · ${totalSku} SKU`}
        title="MENU MAP"
        right={
          <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74", textAlign: "right", maxWidth: 280 }}>
            品項字串一律經 <span style={{ color: "var(--acc,#F5D400)" }}>menuLookup()</span> · 禁 hardcode（憲章 #1）
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.7fr", gap: 12, padding: "8px 24px 80px", alignItems: "start" }}>

        {/* ====== LEFT: SKU 清單 ============================== */}
        <div style={{ minWidth: 0 }}>
          {/* cat chips */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {(["all", "combo", "single"] as const).map((v) => {
              const on = catFilter === v;
              return (
                <button key={v} type="button" onClick={() => setCatFilter(v)} style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: on ? "#111" : "#9A9AA2", background: on ? "#F5F4EF" : "transparent", border: `1px solid ${on ? "#F5F4EF" : C.border}`, padding: "5px 12px", cursor: "pointer", borderRadius: 0 }}>
                  {v === "all" ? "全部" : v === "combo" ? "組合" : "單品"}
                </button>
              );
            })}
          </div>
          {/* search */}
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋品項 / 別名…" style={{ ...inp(), padding: "9px 12px", width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
          {/* list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 640, overflowY: "auto" }}>
            {filteredIds.length === 0 && <div style={{ fontFamily: F.mono, fontSize: 12, color: C.mut, padding: "24px 12px", textAlign: "center", border: `1px dashed ${C.borderDash}` }}>無符合品項</div>}
            {filteredIds.map((id) => {
              const p = localProducts[id]!;
              const on = id === selectedId;
              const cc = p.category === "combo" ? "#F5D400" : "#2AC7E8";
              return (
                <button key={id} type="button" onClick={() => handleSelect(id)} style={{ background: on ? "#1c1600" : C.card, border: `1px solid ${on ? "var(--acc,#F5D400)" : C.line}`, borderLeft: `3px solid ${on ? "var(--acc,#F5D400)" : C.border}`, padding: "11px 13px", cursor: "pointer", textAlign: "left", borderRadius: 0, width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: on ? "#F5F4EF" : C.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.display_name}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 12, color: "#E7E7EA", flexShrink: 0 }}>${p.price ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                    <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 9, color: cc, border: `1px solid ${cc}`, padding: "1px 7px" }}>{p.category === "combo" ? "組合" : "單品"}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74" }}>賣出 {p.seen_count}</span>
                    {p.notes && <span style={{ fontFamily: F.mono, fontSize: 10, color: C.orange }}>⚠</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ====== RIGHT: 編輯器 ================================ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>

          {/* Claude Code 建議區（靜態 demo，憲章 #2） */}
          {showSuggest && (
            <div style={{ background: "#160f26", border: `1px solid ${C.purple}`, borderLeft: `3px solid ${C.purple}`, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#b79ae6" }}>◆ Claude Code 建議</span>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74" }}>MCP · suggest_new_menu_item · 信心 0.88</span>
              </div>
              <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.ink3, lineHeight: 1.6 }}>
                新品項 <span style={{ color: C.ink, fontWeight: 900 }}>{STATIC_SUGGESTION.display_name}</span> 於 07/15 匯入首次出現、售 <span style={{ fontFamily: F.mono, color: C.green }}>${STATIC_SUGGESTION.price}</span>（= 芝麻 720 ＋ 白玉夾餡 100）。建議新增 SKU、綁定別名與簽章。
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 8, fontFamily: F.mono, fontSize: 11 }}>
                <span style={{ color: C.green }}>+ contains {STATIC_SUGGESTION.contains[0]?.atom} ×{STATIC_SUGGESTION.contains[0]?.count}</span>
                <span style={{ color: C.green }}>+ include [{STATIC_SUGGESTION.match_signature.include.join(", ")}]</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" onClick={handleAccept} style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111", background: C.green, padding: "7px 16px", cursor: "pointer", border: "none", borderRadius: 0 }}>採用並新增</button>
                <button type="button" onClick={() => setShowSuggest(false)} style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: C.mut, border: `1px solid ${C.border}`, background: "transparent", padding: "7px 16px", cursor: "pointer", borderRadius: 0 }}>拒絕</button>
              </div>
            </div>
          )}

          {/* 主編輯器 */}
          {selProd ? (
            <div style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              {/* header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "16px 20px 14px" }}>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>SKU · {selectedId}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {saved && <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: C.green, padding: "7px 4px" }}>✓ in-memory 已更新</span>}
                  <button type="button" onClick={handleSave} style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111", background: "var(--acc,#F5D400)", padding: "7px 14px", cursor: "pointer", border: "none", borderRadius: 0 }}>儲存（local）</button>
                </div>
              </div>
              <div style={{ height: 9, background: "repeating-linear-gradient(45deg,var(--acc,#F5D400) 0 14px,#111 14px 28px)" }} />

              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>

                {/* display_name / category / price */}
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1.1fr 0.9fr", gap: 12, alignItems: "end" }}>
                  <div>
                    <Label>顯示名稱 display_name</Label>
                    <input type="text" value={edit.display_name} onChange={(e) => { setEdit((s) => ({ ...s, display_name: e.target.value })); setSaved(false); }} style={{ width: "100%", boxSizing: "border-box", fontFamily: F.tc, fontWeight: 900, fontSize: 18, color: C.ink, background: C.card, border: `1px solid ${C.border}`, padding: "9px 12px", outline: "none", borderRadius: 0 }} />
                  </div>
                  <div>
                    <Label>分類 category</Label>
                    <div style={{ display: "flex", gap: 2 }}>
                      {(["combo", "single"] as const).map((cat) => {
                        const on = edit.category === cat;
                        return <button key={cat} type="button" onClick={() => { setEdit((s) => ({ ...s, category: cat })); setSaved(false); }} style={{ flex: 1, textAlign: "center", fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: on ? "#111" : C.mut, background: on ? (cat === "combo" ? "var(--acc,#F5D400)" : "#2AC7E8") : C.track, padding: "9px 0", cursor: "pointer", border: "none", borderRadius: 0 }}>{cat === "combo" ? "combo 組合" : "single 單品"}</button>;
                      })}
                    </div>
                  </div>
                  <div>
                    <Label>售價 price</Label>
                    <div style={{ display: "flex", alignItems: "center", background: C.card, border: `1px solid ${C.border}` }}>
                      <span style={{ fontFamily: F.mono, fontSize: 13, color: C.mut, paddingLeft: 10 }}>$</span>
                      <input type="text" value={edit.price} onChange={(e) => { setEdit((s) => ({ ...s, price: e.target.value })); setSaved(false); }} style={{ flex: 1, fontFamily: F.mono, fontWeight: 700, fontSize: 16, color: C.ink, background: "transparent", border: "none", padding: "9px 10px 9px 4px", outline: "none", borderRadius: 0, width: "100%", boxSizing: "border-box" }} />
                    </div>
                  </div>
                </div>

                {/* contains */}
                <div>
                  <Label>原子拆解 contains · 出爐統計以此計數</Label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {edit.contains.length === 0 && <div style={{ fontFamily: F.mono, fontSize: 12, color: C.mut, padding: "10px 12px", background: C.track }}>無原子</div>}
                    {edit.contains.map((a, idx) => (
                      <div key={`${a.atom}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 10, background: C.track, padding: "9px 12px" }}>
                        <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: "#E7E7EA", flex: 1 }}>{a.atom}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>{atomUnit(a.atom, menu.atoms)}</span>
                        <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.border}` }}>
                          <button type="button" onClick={() => changeCount(idx, -1)} style={{ fontFamily: F.mono, fontSize: 13, color: C.mut, padding: "4px 10px", cursor: "pointer", background: "transparent", border: "none", borderRadius: 0 }}>−</button>
                          <span style={{ fontFamily: F.anton, fontSize: 15, color: C.ink, padding: "2px 10px", minWidth: 20, textAlign: "center" }}>{a.count}</span>
                          <button type="button" onClick={() => changeCount(idx, 1)} style={{ fontFamily: F.mono, fontSize: 13, color: C.mut, padding: "4px 10px", cursor: "pointer", background: "transparent", border: "none", borderRadius: 0 }}>＋</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* match_signature */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, letterSpacing: ".12em" }}>比對簽章 match_signature</span>
                    <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 10, color: "#111", background: "var(--acc,#F5D400)", padding: "1px 8px" }}>自動 lookup 關鍵字</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* include */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: F.mono, fontSize: 11, color: C.green, width: 56, flexShrink: 0 }}>include</span>
                      {edit.match_signature.include.map((w) => (
                        <span key={w} style={tagBtn(C.green, "#0f2410", "#1f5a1b")}>{w}<button type="button" onClick={() => removeInc(w)} style={{ background: "transparent", border: "none", color: "#2a6e26", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}>✕</button></span>
                      ))}
                      <input type="text" value={incInput} onChange={(e) => setIncInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addInc()} placeholder="＋ Enter" style={{ ...inp(), padding: "4px 10px", width: 90 }} />
                    </div>
                    {/* exclude */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: F.mono, fontSize: 11, color: C.red, width: 56, flexShrink: 0 }}>exclude</span>
                      {edit.match_signature.exclude.map((w) => (
                        <span key={w} style={tagBtn(C.red, "#2a1010", "#5a1b1b")}>{w}<button type="button" onClick={() => removeExc(w)} style={{ background: "transparent", border: "none", color: "#7a2626", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}>✕</button></span>
                      ))}
                      <input type="text" value={excInput} onChange={(e) => setExcInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addExc()} placeholder="＋ Enter" style={{ ...inp(), padding: "4px 10px", width: 90 }} />
                    </div>
                  </div>
                </div>

                {/* aliases */}
                <div>
                  <Label>別名 aliases · 賣貨便/面交/KOL 原文（{edit.aliases.length}）</Label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                    {edit.aliases.length === 0 && <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut, padding: "8px 11px", border: `1px dashed ${C.borderDash}` }}>無別名</div>}
                    {edit.aliases.map((al) => (
                      <div key={al} style={{ display: "flex", alignItems: "center", gap: 8, background: C.card, border: `1px solid ${C.line}`, padding: "7px 11px" }}>
                        <span style={{ fontFamily: F.mono, fontSize: 11, color: "#9A9AA2", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{al}</span>
                        <button type="button" onClick={() => removeAlias(al)} style={{ fontFamily: F.mono, fontSize: 12, color: "#4a4a52", cursor: "pointer", background: "transparent", border: "none", padding: 0, lineHeight: 1 }}>✕</button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 6 }}>
                      <input type="text" value={aliasInput} onChange={(e) => setAliasInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAlias()} placeholder="＋ 新增別名（賣貨便權威原文）" style={{ flex: 1, fontFamily: F.mono, fontSize: 11, color: "#E7E7EA", background: "transparent", border: `1px dashed ${C.borderDash}`, padding: "8px 11px", outline: "none", borderRadius: 0 }} />
                      <button type="button" onClick={addAlias} style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 11, color: C.mut, background: C.track, border: `1px solid ${C.border}`, padding: "8px 12px", cursor: "pointer", borderRadius: 0 }}>加入</button>
                    </div>
                  </div>
                </div>

                {/* notes（唯讀顯示） */}
                {selProd.notes && (
                  <div style={{ background: "#1a1206", borderLeft: `3px solid ${C.orange}`, padding: "11px 14px" }}>
                    <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 11, color: C.orange, marginBottom: 4 }}>⚠ 命名/定價註記</div>
                    <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: C.ink3, lineHeight: 1.6 }}>{selProd.notes}</div>
                  </div>
                )}

                {/* footer */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", paddingTop: 12, borderTop: `1px solid ${C.line}`, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74" }}>seen_count {selProd.seen_count} · 由 analyzer 統計、不覆蓋此檔</span>
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", textAlign: "right", maxWidth: 240, lineHeight: 1.5 }}>
                    匯出 menu.yaml → MCP <span style={{ color: "var(--acc,#F5D400)" }}>write_menu_yaml</span> 或「下載 YAML」鈕（瀏覽器無法直接寫檔）
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 48, textAlign: "center" }}>
              <div style={{ fontFamily: F.anton, fontSize: 32, color: C.mut, marginBottom: 12, letterSpacing: ".03em" }}>NO SKU SELECTED</div>
              <div style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>從左欄點選一個品項開始編輯</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
