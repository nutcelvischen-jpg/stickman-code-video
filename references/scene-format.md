# 場景 JSON 規格 · Scene format

時間單位都是**秒**。場景內的時間（`at`、`t`、`from/to`）都從該場景開頭算起。座標原點在左上，y 往下。

## 專案 (root)

```jsonc
{
  "width": 1280, "height": 720, "fps": 30,
  "bg": "#FDFDFC",          // 紙色
  "grid": true,             // 淡方格紙
  "boil": 4,                // 線條「沸騰」：每 N 影格換一次抖動（0 = 關閉）
  "jitter": 1.1,            // 手繪抖動幅度 px
  "lineScale": 1,           // 全片線寬倍率
  "palette": { "red": "#E0453A" },   // 覆寫／新增具名顏色
  "font": "Huninn",         // 預設內附 jf open 粉圓
  "fonts": [{ "path": "fonts/x.ttf", "family": "X" }],  // 自備字型（相對於 JSON）
  "captionSize": 34,        // 1280 寬時的字幕字級
  "captions": [{ "from": 0, "to": 3, "text": "絕對時間的字幕" }],
  "audio": [{ "src": "narration.wav", "at": 0, "volume": 1 }],  // 絕對時間；可放多軌音效
  "scenes": [ /* ... */ ]
}
```

具名顏色：`ink` `paper` `gray` `light` `red` `blue` `yellow` `green` `orange` `purple` `pink`，也可直接寫 `#hex`。

## 場景 scene

```jsonc
{
  "dur": 4.5,
  "transition": { "type": "wipe", "dur": 0.45 },   // cut | wipe | wipeLeft | fade | iris
  "bg": "#FFF8EC", "grid": false,                  // 可覆寫
  "camera": [{ "t": 0, "x": 640, "y": 360, "zoom": 1 }, { "t": 2, "zoom": 1.15, "ease": "inOut" }],
  "shake": [{ "at": 2.1, "mag": 10, "dur": 0.3 }],
  "captions": [{ "from": 0, "to": 4.4, "text": "場景內時間的字幕" }],
  "actors": [ /* ... */ ],
  "elements": [ /* ... */ ]
}
```

鏡頭 `x,y` 是畫面中心看向的世界座標。拉近時注意地面不要掉進底部字幕帶（字幕帶高度 = 畫面高 × 0.155）。

## 角色 actor

```jsonc
{
  "id": "me",                 // 必填，元素可用來附著
  "x": 300, "y": 580,         // y = 地面（腳底）位置
  "scale": 1.4,               // 1.4 ≈ 270px 高
  "dir": 1,                   // 1 面右、-1 面左
  "pose": "stand",            // 名稱或物件，見下
  "face": "neutral",
  "view": 0.32,               // 臉朝向偏移，0 = 正面
  "accessory": { "type": "cap", "color": "red" },  // hair | ponytail | cap | beanie | glasses：區分角色
  "color": "ink", "width": 4, "z": 1, "idle": true,
  "enter": { "at": 0, "type": "draw", "dur": 0.8 },   // draw（逐筆畫出）| pop | fade | none
  "exit":  { "at": 4, "type": "fade", "dur": 0.3 },
  "keys": [                   // 關鍵影格：任何屬性都可只寫一部分
    { "t": 1.2, "pose": "point", "face": "happy", "blend": 0.3 },
    { "t": 2.0, "x": 520, "ease": "out" },
    { "t": 3.0, "dir": -1 }
  ],
  "acts": [                   // 程序化動作，疊加在姿勢上
    { "type": "walk", "from": 0, "to": 2, "toX": 700 },
    { "type": "talk", "from": 0.5, "to": 3.5 }
  ]
}
```

- `pose`/`face` 在關鍵影格之間會**平滑混合**（`blend` 秒數，預設 ≤0.45）。
- 姿勢可以寫物件微調：`{ "base": "point", "head": -15, "armL": [-40, 60] }`。
- `ease`：`linear` `in` `out` `inOut` `back` `elastic` `bounce` `step`。

### 姿勢角度系統

角度單位為度。**0 = 垂直朝下；正值 = 往角色面向的方向（前方）轉**。

| 欄位 | 意義 |
|---|---|
| `lean` | 軀幹前傾 |
| `head` | 點頭（+ 低頭 / − 抬頭） |
| `armL` / `armR` | `[肩, 肘]`：肩為上臂角度；肘彎曲往前／上加 |
| `legL` / `legR` | `[髖, 膝]`：膝蓋往後彎 |
| `rot` | 整個身體繞髖旋轉（躺下 = 90） |
| `lift` | 離地高度 px |
| `ground:false` + `hipY` | 坐姿：髖部離地高度（scale 1 時 px） |

例：手平舉向前 `armR: [90, 0]`；舉高 `[160, 5]`；手放下巴 `[22, 150]`。內建姿勢見 `poses.png`：
`stand relaxed wave point pointUp present cheer think shrug facepalm sad tired surprised scared angry hold holdUp type crouch run walk sit sitType sitSlump lie bow dance1 dance2`

### 表情

`neutral happy laugh sad cry angry surprised scared think confused sleepy determined smug worried wow`（見 `faces.png`）。
自訂：`{ "base": "happy", "smile": 1, "open": 0.4, "brow": -0.5, "raise": 0.6, "eye": 1.3, "sweat": 1, "blush": 1, "tears": 1 }`
（`smile` −1…1、`open` 0…1、`brow` −1 擔心…1 生氣、`raise` 眉毛上揚、`eye` 張開程度，>1.2 變大眼、`arc` 1 = 笑瞇眼、`asym` 不對稱）。

### 動作 acts

| type | 參數 | 說明 |
|---|---|---|
| `walk` / `run` | `toX` `toY` `stride` `amount` `keepArms` | 依實際位移計算步伐，腳不打滑；有 `toX` 會自動轉向與移動 |
| `talk` | `amount` | 嘴巴開合 |
| `wave` | `arm: "L"|"R"` `speed` | 揮手 |
| `nod` / `shake` | `speed` | 點頭／搖頭 |
| `jump` | `height` | 蹲 → 跳 → 落地（整個區間） |
| `hop` / `bounce` | `height` `speed` | 開心小跳 |
| `type` | | 打字 |
| `tremble` | `amount` | 發抖／震驚 |
| `dance` | `speed` | 在 dance1/dance2 之間擺動 |
| `scratch` | | 抓頭 |

## 元素 element

共用欄位：

```jsonc
{
  "type": "bulb", "x": 860, "y": 230, "scale": 1.2, "rot": 0,
  "color": "ink", "width": 4, "fill": "yellow", "fillAlpha": 0.35, "z": 0,
  "at": 1.0, "dur": 0.6, "anim": "draw",   // draw（逐筆畫出）| pop | fade | type（文字）| none
  "out": 3.5, "outDur": 0.3, "outAnim": "fade",   // 消失
  "loop": "bob",                                  // bob | float | spin | wiggle | pulse | shake
  "keys": [{ "t": 1, "x": 860, "y": 230 }, { "t": 2, "x": 1100, "rot": 20, "scale": 0.8, "opacity": 0.5 }],
  "attach": { "actor": "me", "joint": "handR", "dx": 0, "dy": -10 }  // 跟著角色關節移動（拿東西）
}
```

可附著關節：`head neck shoulder hip handL handR elbowL elbowR kneeL kneeR ankleL ankleR toeL toeR`。
`z`：角色預設 1、元素 0、附著元素 2；數字大的畫在上面。

### 元素類型

**文字**
`text`：`text`（`\n` 換行）`size` `color` `weight` `align` `anim:"type"|"pop"|"fade"` `underline: true|"red"`（畫完後補手繪底線）`highlight:"yellow"`（螢光筆）`stroke` `lineHeight`

**基本線條**
- `line`：`pts:[[x,y],...]`（相對 x,y）`closed`
- `path`：`d`（SVG path，支援 M L H V C S Q T A Z）——**內建沒有的東西都用這個畫**
- `circle` `r` ・ `ellipse` `rx ry` ・ `rect` `w h r`（圓角）・ 這三種可帶 `text` `textSize`
- `arrow`：`from:[x,y]` `to:[x,y]`（世界座標，元素 x,y 設 0）`bend` `head`
- `underline` `w` ・ `circleMark` `rx ry`（圈重點）・ `ground` `w`

**對話**
`bubble`（對話框）／`thought`（思考雲）：`w h tail:[dx,dy]`（尾巴指向，相對中心）`text` `textSize`

**圖表**
- `bars`：`values:[0..1]` `colors` `h` `barW` `gap` `growDur`（會長高）
- `linechart`：`values:[0..1]` `w h lineColor`

**特效**
`burst`（放射爆點，`r0 r1 n`）・ `speed`（速度線）・ `sparkle`

**圖示（約 80–100px）**
`bulb heart star question exclaim check cross clock(spin) gear(spin) coin phone laptop monitor desk chair door window tree house cloud sun rain box flag trophy rocket doc bolt magnifier target battery(level) zzz ai`

布景尺寸參考（scale 1.4 的角色、地面 y=580）：`desk` 放 `y = 493, scale 1.4`；`chair` 放 `y = 513, scale 1.4`、與坐姿角色同 x；`laptop` 放桌面 `y = 465`。

## 指令

```bash
node render.mjs scene.json -o out.mp4                 # 整片
node render.mjs scene.json --from 8 --to 14 -o part.mp4
node render.mjs scene.json --sheet sheet.png --frames 16
node render.mjs scene.json --still 6.2 -o f.png
node render.mjs scene.json --scale 0.5 -o draft.mp4   # 快速草稿
node tools/build-player.mjs scene.json -o preview.html
```

場景也可以寫成 `.mjs`（`export default {...}`），用迴圈或函式產生大量元素。
