# tiktok-ar-smile-effects

直播 AR 表情特效 Demo：主播微笑时头顶下一场带彩虹的轻雨，大笑时放一束香槟礼花，雨滴和火花会和头部、肩膀碰撞。人脸识别在本机浏览器里完成，视频不上传。

**在线演示：** https://aerol1n.github.io/tiktok-ar-smile-effects/

## 本地运行

```bash
npm install
npm run dev
```

人脸模型和 MediaPipe wasm 已随仓库提供（`public/models/`、`public/wasm/`），不需要额外下载。

浏览器访问 Vite 地址后，点击“开启摄像头”。摄像头需要 HTTPS 或 `localhost`，视频不会上传服务器。

## 当前范围

- 前置摄像头 640×480 目标输入
- MediaPipe Face Landmarker，最多检测两张脸并选取画面中最大的人脸
- `mouthSmile`、`jawOpen`、人脸数量和识别频率
- 微笑 / 大笑 / 等待表情的初始判定，带退出迟滞
- 权限拒绝、模型缺失和不支持摄像头时的可读错误提示
- 页面进入后台时停止摄像头和识别

- 微笑：头部水雾 + 雾里的彩虹 + 头顶轻雨，落到头发和肩膀上有水花
- 大笑：香槟礼花，火花碰到头会弹开
- 粒子放在定长对象池里，数量有上限；贴图预先生成，每帧只贴图

## 演示模式

打开页面默认进入演示模式，不需要摄像头：自动轮播微笑与大笑效果，也可以用底部按钮固定微笑或大笑，点“自动轮播”恢复循环；右上角可随时切到摄像头。表情由按钮模拟，不是识别结果。

演示照片 `public/demo/model-smile.jpg`、`model-laugh.jpg` 是 **AI 生成的人像**，不是真人照片，仅用于效果演示。照片里的人脸位置是用 Face Landmarker 对这张图识别一次后写入 `src/rules/demo.js` 的。


## 部署

GitHub Pages 发布 `dist/`：

```bash
npm run build
# 将 dist/ 推送到 gh-pages 分支
```

线上地址：https://aerol1n.github.io/tiktok-ar-smile-effects/ （HTTPS，摄像头可用）。
