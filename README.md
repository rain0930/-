# 英雄聯盟派對答題（獨立版）

不需要 npm install，只要有 Node.js 18 以上。

## 啟動
    node server.js
畫面會印出：
- 主持人網址（開在電腦／電視上，網址最後的 key 是主持人金鑰）
- 玩家網址（讓朋友用手機開）

## 玩法
1. 主持人開 /host 網址，朋友用手機開玩家網址並輸入暱稱
2. 主持人按「開始遊戲」→「公布答案」→「下一題」…
3. 每次「重新開始」都會重新隨機抽題

## 自訂
- 題目：編輯 questions.json（c: g 一般 / a ARAM；t: choice, tf, text, order, num）
- 圖片題：把你有權使用的圖片放進 public/images/，在題目加上 "img":"檔名.png"（用 choice 題型）
- 環境變數：PORT、PER（每場題數）、ARAM_N、IMG_N、HOST_KEY

## 讓不同地方的朋友連線
在自己電腦執行只有同一個 Wi-Fi 的人連得到。遠端玩要部署到雲端（Render、Railway 等），啟動指令用 node server.js，並設定 HOST_KEY。
