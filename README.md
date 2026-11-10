# tiktok-ar-smile-effects

Part 2 AR 表情特效 Demo 的第一阶段骨架：摄像头画面、本地人脸识别、表情系数和调试状态。

## 本地运行

```bash
npm install
npm run prepare:vision
```

把 `face_landmarker.task` 放进 `public/models/`，然后运行：

```bash
npm run dev
```

浏览器访问 Vite 地址后，点击“开启摄像头”。摄像头需要 HTTPS 或 `localhost`，视频不会上传服务器。

## 当前范围

- 前置摄像头 640×480 目标输入
- MediaPipe Face Landmarker，最多检测两张脸并选取画面中最大的人脸
- `mouthSmile`、`jawOpen`、人脸数量和识别频率
- 微笑 / 大笑 / 等待表情的初始判定，带退出迟滞
- 权限拒绝、模型缺失和不支持摄像头时的可读错误提示
- 页面进入后台时停止摄像头和识别

雨滴、烟花、头部碰撞、粒子对象池和性能降级会在识别骨架稳定后加入。
