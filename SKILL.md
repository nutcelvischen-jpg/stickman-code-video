---
name: stickman-code-video
description: "把主題、文章或腳本做成「純程式繪製」的線條火柴人動畫影片。不用任何圖片／影片生成 AI：用骨架 + 關節角度畫火柴人，用時間軸 JSON 驅動動作、表情、道具與字幕，在本機輸出 MP4。Turn a topic or script into a line-art stickman animation drawn entirely by code (FK rig + scene JSON → MP4)."
---

# Stickman Code Video · 純程式線條火柴人動畫

所有畫面都由程式碼畫出：火柴人是一組**關節角度**（前向運動學），道具是**折線／SVG path**，整部片共用同一種「手繪抖動線條」語言，並可逐筆「畫出來」。不需要 Gemini、Midjourney 或任何生成式圖片／影片服務。

改寫自 [kaomei/stickman-video-director](https://github.com/kaomei/stickman-video-director)（MIT）的 B1 極簡手繪風導演原則；生成式流程全部改為程式繪製。

## 檔案

| 路徑 | 用途 |
|---|---|
| `engine/stickman.js` | 引擎（零依賴，瀏覽器／Node 共用）：骨架、姿勢庫、表情庫、動作、道具、鏡頭、轉場、字幕 |
| `render.mjs` | Node 算圖 → MP4（ffmpeg），也能出單張或分鏡總覽圖 |
| `tools/build-player.mjs` | 產生單檔 HTML 預覽播放器（拖曳時間軸、瀏覽器錄 WebM） |
| `tools/character-sheet.mjs` | 匯出角色設定圖（頭像／正面／側面／背面＋表情），可當 AI 生圖的參考圖（例如 handraw-style 角色庫） |
| `tools/gallery.mjs` | 重新產生 `references/poses.png`、`faces.png` |
| `references/scene-format.md` | **場景 JSON 完整規格**（撰寫前必讀） |
| `references/directing.md` | 導演方法：如何把內容拆成鏡頭、表演與節奏 |
| `references/poses.png` / `faces.png` | 內建姿勢與表情目錄（看圖選用） |
| `examples/ai-workflow.scene.json` | 27 秒完整示範（只供理解格式，**不要照抄劇情或構圖**） |

## 環境

Node 20+、FFmpeg。在 skill 目錄執行一次 `npm install`（只依賴 `@napi-rs/canvas`）。中文字型已內附 jf open 粉圓（OFL），註冊名稱 `Huninn`。

## 工作流程

1. **確認需求**（缺什麼一次問完）：內容來源、長度、比例（16:9 → 1280×720；9:16 → 720×1280）、語言、有無旁白音檔。不要捏造數據、引言或產品功能。
2. **寫旁白與分段**：依 `references/directing.md` 拆成 4–10 個場景，每場一個想法。先定旁白，再配畫面。
3. **設計每一鏡**：每場寫下「一句旁白 → 一個主要動作 → 一個視覺重點（大字／道具／圖表）」。挑姿勢與表情時先看 `references/poses.png`、`faces.png`；內建沒有的道具，用 `path`（SVG path）或 `line` 自己畫。
4. **寫場景 JSON**：放在專案資料夾（**不要寫進 skill 目錄**）。規格見 `references/scene-format.md`。
5. **先看分鏡總覽再算整片**：
   ```bash
   node <skill>/render.mjs project.scene.json --sheet sheet.png --frames 16
   node <skill>/render.mjs project.scene.json --still 7.5 -o check.png
   ```
   用眼睛檢查：人物有沒有被字幕帶切到、文字是否重疊、道具是否在畫面內、每 2.5 秒內畫面是否有進展。
6. **算圖**：`node <skill>/render.mjs project.scene.json -o out.mp4`（720p 30fps 約 4–5 倍速）。有旁白／音效就在 JSON 的 `audio` 填檔案與起始秒數，會一起混音。
7. **預覽／分享**：`node <skill>/tools/build-player.mjs project.scene.json -o preview.html`。
8. **驗收**（見 directing.md 的檢查表）後交付；修改時只改有問題的場景，可用 `--from/--to` 只算一段。

## 原則

- **線條為主**：墨線 + 少量強調色（紅、藍、黃、綠）。填色只用淡淡的螢光筆效果。
- **不讓角色發呆**：引擎預設有呼吸微動；每場仍要安排有意義的動作（走、指、打字、跳、揮手）。
- **全身表演**：情緒同時改變表情、頭、身體傾斜、手臂與站姿；同一表情不要整部片重複。
- **內容決定畫面**：參考範例是格式教材，不是模板。新主題要設計新的場景、道具與動作。
- **字幕單行、依語意斷句**，對齊旁白實際時間。
