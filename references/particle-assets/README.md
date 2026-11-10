# 烟花粒子素材与参考

只用于 Part 2 烟花效果的视觉参考和预渲染贴图，不参与表情识别逻辑。

## 已下载素材

### Kenney Particle Pack

- 来源：https://kenney.nl/assets/particle-pack
- 镜像：https://github.com/Calinou/kenney-particle-pack
- 许可证：CC0 1.0，可商用、可修改、无需署名（见 `kenney-LICENSE.txt`）
- 格式：512×512 PNG，灰度 + alpha，运行时用 `globalCompositeOperation` 或着色器染色

| 文件 | 用途 |
|---|---|
| `kenney-light_01.png` | 主烟花核心光晕 |
| `kenney-star_07.png` | 主爆点中心星芒 |
| `kenney-star_08.png` | 碰撞反馈、粒子高光 |
| `kenney-circle_01.png` | 环形结构、冲击波轮廓 |
| `kenney-twirl_03.png` | 旋转丝线、环形装饰 |
| `kenney-trace_05.png` | 上升拖尾、火星尾迹 |
| `kenney-smoke_03.png` | 爆炸后的烟雾残影 |
| `kenney-spark_04.png` / `kenney-spark_05.png` | 少量电光感火花，可选 |

### Fireworks Effect Spritesheet

- 来源：https://opengameart.org/content/fireworks-effect-spritesheet
- 作者：jellyfizh
- 许可证：CC0
- 格式：1536×1280，6×5 共 30 帧，单帧 256×256，黄色烟花由小到大再淡出
- 用途：参考单发烟花的展开节奏和淡出曲线，不建议整段直接播放

## 可参考的开源代码

| 项目 | 许可证 | 参考价值 |
|---|---|---|
| [nothingnothings/threejs-fireworks](https://github.com/nothingnothings/threejs-fireworks) | MIT | Three.js 点击发射 + 爆炸粒子结构 |
| [Alchemist0823/three.quarks](https://github.com/Alchemist0823/three.quarks) | MIT | 完整 Three.js 粒子系统，适合复杂多层烟花 |
| [tsparticles/tsparticles](https://github.com/tsparticles/tsparticles) | MIT | 2D 粒子发射器和配置化效果 |
| [automattic/canvas-fireworks](https://github.com/automattic/canvas-fireworks) | 未声明 | 只能阅读思路（core / shell / ring 三层结构），不要直接复制代码 |

## 使用约束

- 贴图只作为粒子的外观，不替代实时碰撞和头部互动。
- 主烟花建议：贴图负责光晕、星芒、环形和烟雾；程序化粒子负责速度、重力、拖尾和碰撞。
- 不要整段播放烟花视频，否则无法与头部位置和移动产生互动。